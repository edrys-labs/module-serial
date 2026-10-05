# Edrys Serial Module

This module uses WebSerial to share a live serial terminal from a station with everyone in the station's room.
It is useful for remote labs, for example to let students use an Arduino's serial monitor remotely.

The station connects to the device. Everything the device prints shows up in every participant's terminal, and
anything a participant types is sent to the device.

WebSerial is [not supported in all browsers](https://caniuse.com/web-serial). The **station** needs a browser
that supports it: Chrome or Edge (89+), Opera (76+) or Firefox (151+), but not Safari. Students don't touch
the serial port, so any browser works for them.

## Usage

Add the module to your class with this URL:

```
https://edrys-labs.github.io/module-serial/
```

The module is only shown in stations (`show-in: station`), not in normal rooms.

1. Open the station.
2. Choose the baud rate in the header and click **Connect**.
3. Pick the device in the browser's port dialog.

Students join the station's room and can use the terminal right away.

The header shows the device status to everyone: **not connected**, **connecting…** or
**connected · 9600 baud**. Students who type while no device is connected get a notice in the terminal; their
input is not sent anywhere.

In the terminal:

- **ctrl+shift+x** copies the selection
- **ctrl+shift+v** pastes into the device

Errors are printed in the terminal, for example `[could not connect: …]` when the port is busy, or
`[serial error: …]` after a wrong baud rate or a device reset.

## Configuration

The module has one setting, under **Station config** in the module settings:

| Field  | Type   | Default | Description                    |
| ------ | ------ | ------- | ------------------------------ |
| `baud` | number | `9600`  | Default baud rate of the device |

```json
{
  "baud": 115200
}
```

Any baud rate works, including ones that are not in the dropdown (e.g. `74880`). The configured value wins
over the last rate chosen on the station. Without a configured value, the station remembers its own last
choice.

## For module developers

Other modules in the station's room can read from and write to the device through Edrys messages. The station
listens in promiscuous mode, so messages from any module reach it.

| Subject | Direction            | Body                                 |
| ------- | -------------------- | ------------------------------------ |
| `w`     | any peer → station   | string, written to the device as is  |
| `r`     | station → everyone   | string, output read from the device  |

```js
// send a line to the device
Edrys.sendMessage('w', 'help\n')

// receive device output (promiscuous, since it comes from another module)
Edrys.onMessage(({ subject, body }) => {
  if (subject === 'r') console.log(body)
}, true)
```

The device status is kept in the room state under the key `serial-status`, as
`{ state: 'on' | 'off' | 'wait', baud }`:

```js
const status = Edrys.getState('serial-status', 'Value')
```

## Limitations

- Only one serial module per station room: two instances would share the same message subjects and status key.
- Disconnecting, or unplugging the device, reloads the module on the station; click **Connect** again to
  reconnect.
