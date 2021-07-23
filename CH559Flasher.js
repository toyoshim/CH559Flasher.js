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

  async #send(name, request, responseSize) {
    let result = await this.#device.transferOut(this.#epOut, request);
    if (result.status !== 'ok') {
      this.error = name + 'RequestError';
      return null;
    }
    result = await this.#device.transferIn(this.#epIn, responseSize);
    if (result.status !== 'ok') {
      this.error = name + 'ResponseError';
      return null;
    }
    return result.data;
  }

  async #writeVerify(firmware, progressCallback, write) {
    if (this.error)
      return false;
    const data = new Uint8Array(firmware);
    const cmd = new Uint8Array(64);
    const mode = write ? 'write' : 'verify';
    cmd[0] = write ? 0xa5 : 0xa6;
    for (let i = 0; i < data.length; i += 0x38) {
      const remainingSize = data.length - i;
      const payloadSize = (remainingSize >= 0x38) ? 0x38 : remainingSize;
      cmd[1] = payloadSize + 5;
      cmd[3] = i & 0xff;
      cmd[4] = (i >> 8) & 0xff;
      cmd[7] = remainingSize & 0xff;
      for (let j = 0; j < payloadSize; ++j)
        cmd[8 + j] = data[i + j];
      for (let j = 8 + payloadSize; j < 64; ++j)
        cmd[j] = 0xff;
      for (let j = 7; j < 64; j += 8)
        cmd[j] ^= this.#chipId;
      const result = await this.#send(mode, cmd, 6);
      if (!result)
        return false;
      const resultCode = result.getUint8(4);
      if (resultCode != 0 && resultCode != 0xfe) {
        // 0xfe seems to be the result code for the last block that does not
        // have full data.
        this.error = mode + 'Failed';
        return false;
      }
      if (progressCallback)
        progressCallback((i + payloadSize) / data.length);
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
      this.#device.configuration.interfaces[0].interfaceNumber);
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
    if (!response || response.getUint8(4) != 0x59)
      return false;
    this.#chipId = response.getUint8(4);

    response = await this.#send('identify',
      Uint8Array.of(0xa7, 0x02, 0x00, 0x1f, 0x00), 30);
    if (!response)
      return false;
    this.bootLoader = response.getUint8(19).toString() + '.' +
      response.getUint8(20).toString() + response.getUint8(21).toString();
    if (this.bootLoader[0] !== '2' ||
      (this.bootLoader[2] !== '3' && this.bootLoader[2] !== '4')) {
      this.error = 'unknownBootloader';
    }
    const sum = (response.getUint8(22) + response.getUint8(23) +
      response.getUint8(24) + response.getUint8(25)) & 0xff;

    const bootKeyCmd = new Uint8Array(0x33);
    bootKeyCmd[0] = 0xa3;
    bootKeyCmd[1] = 0x30;
    for (let i = 3; i < 0x33; ++i)
      bootKeyCmd[i] = sum;
    response = await this.#send('bootkey', bootKeyCmd, 6);
    if (!response || response.getUint8(4) != this.#chipId)
      return false;
    return true;
  }

  async erase() {
    if (this.error)
      return false;
    let response = await this.#send('erase',
      Uint8Array.of(0xa4, 0x01, 0x00, this.#eraseSize), 6);
    if (!response)
      return false;
    if (response.getUint8(4)) {
      this.error = 'eraseError';
      return false;
    }
    return true;
  }

  async write(firmware, progressCallback) {
    return this.#writeVerify(firmware, progressCallback, true);
  }

  async verify(firmware, progressCallback) {
    return this.#writeVerify(firmware, progressCallback, false);
  }
}