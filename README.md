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
