// Copyright 2021 Takashi Toyoshima <toyoshim@gmail.com>. All rights reserved.
// Use of this source code is governed by a GPL-3.0 License that can be found
// in the LICENSE file.

class CH559Flasher {
  error = undefined;
  bootLoader = undefined;

  #device = null;
  #epIn = 0;
  #epOut = 0;
  #eraseSize = 60;
  #chipId = 0;
  #initialized = false;

  async #send(name, request, responseSize) {
    let result = await this.#device.transferOut(this.#epOut, request);
    if (result.status !== 'ok') {
      this.error = name + 'RequestError';
      return null;
    }
    if (!responseSize)
      return;

    result = await this.#device.transferIn(this.#epIn, responseSize);
    if (result.status !== 'ok') {
      this.error = name + 'ResponseError';
      return null;
    }
    return result.data;
  }

  async #writeVerifyInRange(addr, buffer, write, dataRegion) {
    if (this.error)
      return false;
    const mode = write ? (dataRegion ? 'writeData' : 'write') : 'verify';
    if (buffer.byteLength > 0x38) {
      this.error = mode + 'InvalidLength';
      return false;
    }
    const data = new Uint8Array(buffer);
    const length = (data.length + 7) & ~7;
    const cmd = new Uint8Array(8 + length);
    cmd[0] = write ? (dataRegion ? 0xaa : 0xa5) : 0xa6;
    cmd[1] = length + 5;
    cmd[2] = 0;
    cmd[3] = addr & 0xff;
    cmd[4] = (addr >> 8) & 0xff;
    cmd[5] = 0;
    cmd[6] = 0;
    cmd[7] = length;
    for (let i = 0; i < length; ++i) {
      if (i < data.length) {
        cmd[8 + i] = data[i];
      } else {
        cmd[8 + i] = 0xff;
      }
      if ((i & 7) != 7)
        continue;
      cmd[8 + i] ^= this.#chipId;
    }
    const result = await this.#send(mode, cmd, 6);
    if (!result)
      return false;
    const resultCode = result.getUint8(4);
    if (resultCode != 0) {
      this.error = mode + 'Failed: $' + resultCode.toString(16);
      return false;
    }
    return true;
  }

  async #writeVerify(firmware, progressCallback, write) {
    if (this.error)
      return false;
    const maxSize = 0x38;
    for (let i = 0; i < firmware.byteLength; i += maxSize) {
      const remainingSize = firmware.byteLength - i;
      const payloadSize = (remainingSize >= maxSize) ? maxSize : remainingSize;
      const result = await this.#writeVerifyInRange(
        i, firmware.slice(i, i + payloadSize), write);
      if (!result)
        return false;
      if (progressCallback)
        progressCallback((i + payloadSize) / firmware.byteLength);
    }
    return true;
  }

  async connect() {
    this.#device = await navigator.usb.requestDevice({
      'filters': [{
        'vendorId': 0x4348, 'productId': 0x55e0
      }]
    });
    await this.#device.open();
    await this.#device.selectConfiguration(
      this.#device.configurations[0].configurationValue);
    await this.#device.claimInterface(
      this.#device.configuration.interfaces[0].interfaceNumber).catch(e => {
        this.error = 'claimFailed';
      });
    if (this.error) {
      return false;
    }
    for (let ep of
      this.#device.configuration.interfaces[0].alternate.endpoints) {
      if (ep.direction === 'in')
        this.#epIn = ep.endpointNumber;
      else if (ep.direction === 'out')
        this.#epOut = ep.endpointNumber;
    }

    let response = await this.#send('detect',
      Uint8Array.of(0xa1, 0x12, 0x00, 0x59, 0x11, 0x4d, 0x43, 0x55, 0x20, 0x49,
        0x53, 0x50, 0x20, 0x26, 0x20, 0x57, 0x43, 0x48, 0x2e, 0x43, 0x4e), 6);
    if (!response || response.getUint8(4) != 0x59) {
      this.error = 'detectFailed';
      return false;
    }
    this.#chipId = response.getUint8(4);

    response = await this.#send('identify',
      Uint8Array.of(0xa7, 0x02, 0x00, 0x1f, 0x00), 30);
    if (!response) {
      this.error = 'identifyFailed';
      return false;
    }
    this.bootLoader = response.getUint8(19).toString() + '.' +
      response.getUint8(20).toString() + response.getUint8(21).toString();
    if (this.bootLoader[0] !== '2' ||
      (this.bootLoader[2] !== '3' && this.bootLoader[2] !== '4')) {
      this.error = 'unknownBootloader';
      return false;
    }
    const sum = (response.getUint8(22) + response.getUint8(23) +
      response.getUint8(24) + response.getUint8(25)) & 0xff;

    const bootKeyCmd = new Uint8Array(0x33);
    bootKeyCmd[0] = 0xa3;
    bootKeyCmd[1] = 0x30;
    for (let i = 3; i < 0x33; ++i)
      bootKeyCmd[i] = sum;
    response = await this.#send('bootkey', bootKeyCmd, 6);
    if (!response || response.getUint8(4) != this.#chipId) {
      this.error = 'bootkeyError';
      return false;
    }

    this.initialized = true;
    return true;
  }

  async erase() {
    return await this.eraseBlock(this.#eraseSize);
  }

  async eraseBlock(size) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    let response = await this.#send('erase',
      Uint8Array.of(0xa4, 0x01, 0x00, size), 6);
    if (!response)
      return false;
    if (response.getUint8(4)) {
      this.error = 'eraseError';
      return false;
    }
    return true;
  }

  // `addr` is absolute address
  // `data` in ArrayBuffer to write
  async writeInRange(addr, data) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    return this.#writeVerifyInRange(addr, data, true);
  }

  // `addr` is absolute address
  // `data` in ArrayBuffer for golden data
  async verifyInRange(addr, data) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    return this.#writeVerifyInRange(addr, data, false);
  }

  async eraseData() {
    if (!this.initialized)
      return false;
    this.error = undefined;
    let response = await this.#send('eraseData',
      Uint8Array.of(0xa9, 0x00, 0x00, 0x00), 6);
    if (!response)
      return false;
    if (response.getUint8(4)) {
      this.error = 'eraseDataError';
      return false;
    }
    return true;
  }

  // `addr` is offset from 0xF000 (DATA_FLASH_ADDR)
  // `data` in ArrayBuffer
  async writeDataInRange(addr, data) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    return this.#writeVerifyInRange(addr, data, true, true);
  }

  // `addr` is offset from 0xF000 (DATA_FLASH_ADDR)
  // `length` in byte to read
  async readDataInRange(addr, length) {
    if (!this.initialized)
      return false;
    const mode = 'readData';
    if (length > 0x38) {
      this.error = mode + 'InvalidLength';
      return false;
    }
    this.error = undefined;
    const cmd = new Uint8Array(8);
    cmd[0] = 0xab;
    cmd[1] = 0;
    cmd[2] = 0;
    cmd[3] = addr & 0xff;
    cmd[4] = (addr >> 8) & 0xff;
    cmd[5] = 0;
    cmd[6] = 0;
    cmd[7] = length;
    const result = await this.#send(mode, cmd, 6 + length);
    if (!result)
      return false;
    const resultCode = result.getUint8(4);
    if (resultCode != 0) {
      this.error = mode + 'Failed: $' + resultCode.toString(16);
      return false;
    }
    return result.buffer.slice(6, 6 + length);
  }

  // `firmware` in ArrayBuffer
  async write(firmware, progressCallback) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    return this.#writeVerify(firmware, progressCallback, true);
  }

  // `firmware` in ArrayBuffer
  async verify(firmware, progressCallback) {
    if (!this.initialized)
      return false;
    this.error = undefined;
    return this.#writeVerify(firmware, progressCallback, false);
  }

  async boot() {
    if (!this.initialized)
      return false;
    this.error = undefined;
    const cmd = new Uint8Array(4);
    cmd[0] = 0xa2;
    cmd[1] = 0x01;
    cmd[2] = 0x00;
    cmd[3] = 0x01;
    return this.#send('boot', cmd);
  }

  // `cfg_hi` is a 8bits value for the ROM_CFG[15:8]
  // This is a risky operation that could make the chip out of control
  async writeConfig(cfg_hi) {
    if (!this.initialized || !cfg_hi)
      return false;
    this.error = undefined;
    if (this.bootLoader == '2.31') {
      return this.#send('writeConfig',
        Uint8Array.of(0xa8, 0x0e, 0x00, 0x07, 0x00,
          0xff, 0xff, 0xff, 0xff,
          0x03, 0x00, 0x00, 0x00,
          0xff, cfg_hi, 0x00, 0x00), 6);
    } else if (this.bootLoader == '2.40') {
      return this.#send('writeConfig',
        Uint8Array.of(0xa8, 0x0e, 0x00, 0x07, 0x00,
          0xff, 0xff, 0xff, 0xff,
          0x23, 0x00, 0x00, 0x00,
          0xf6, cfg_hi, 0xff, 0x97), 6);
    } else {
      console.error('this feature is verified only with 2.31/2.40 firmware');
      return false;
    }
  }
}
