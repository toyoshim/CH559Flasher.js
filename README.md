# CH559Flasher.js

## Usage

```JavaScript
async function flash() {
  const flasher = new CH559Flasher();
  await flasher.connect();
  await flasher.erase();
  const bin = await (await fetch('firmware.bin')).arrayBuffer();
  await flasher.write(bin, rate => console.log(rate));
  await flasher.verify(bin, rate => console.log(rate));
  console.log(flasher.error);
}
```

## APIs
### connect()
Connect to a CH559 based device in firmware update mode.
This should be called first from a user initiated event handler in JavaScript.

### erase()
Erase all program flash memory (0x0000 - 0xEFFF).
All data will be read as 0xFF after this operation.
This should be called before writing to program region.
Chip will reject write operations for program flash memory until this is
called.

### writeInRange(addr: number, data: ArrayBuffer)
Write to the specified range in program flash memory.

### verifyInRange(addr: number, data: ArrayBuffer)
Verify if read data match expected data for the specified range in program
flash memory.

### write(firmware: ArrayBuffer, progressCallback: function)
Write a specified firmware binary.

### verify(firmware: ArrayBuffer, progressCallback: function)
Verify if read data match expected firmware binary.

### eraseData()
Erase data flash memory (0xF000 - 0xF3FF).
All data will be read as 0xFF after this operation and this should be called
before writing to data region as write operaitons only reset bits, and data
will be mixed with the existing data via AND operation.

### writeDataInRange(addr: number, data: ArrayBuffer)
Write to the specified range in data flash memory. The address is an offset
from DATA_FLASH_ADDR (0xF000).

### readDataInRange(addr: number, length: number)
Read from the specified range in data flash memory. The address is an offset
from DATA_FLASH_ADDR (0xF000).