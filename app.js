import { FitAddon } from './xterm/xterm-addon-fit.js'

// Message subjects: device output (station -> all) and input (all -> station)
const SUBJECT_READ = 'r'
const SUBJECT_WRITE = 'w'

const DEFAULT_BAUD = 9600

// Device status, written by the station and stored in the room state
// so that every peer, including late joiners, can show it.
const STATUS_KEY = 'serial-status'
const STATUS_TEXT = {
  on: 'connected',
  off: 'not connected',
  wait: 'connecting…',
}

// ---------------------------------------------------------------------
// Terminal

const term = new Terminal({
  cursorBlink: true,
  macOptionIsMeta: true,
  scrollback: 5000,
  // devices send \n, \r\n or a mix; let xterm turn every \n into \r\n
  convertEol: true,
})
// for debugging in the console, and read by edrys-module-tests
window.term = term
const terminalEl = document.getElementById('terminal')
term.open(terminalEl)
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
fitAddon.fit()
// refit when the iframe or the header row changes size
new ResizeObserver(() => fitAddon.fit()).observe(terminalEl)
// status messages are written by renderStatus() once Edrys is ready

function sendInput(text) {
  warnIfDisconnected()
  Edrys.sendMessage(SUBJECT_WRITE, text)
}

term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown') return true
  if (e.ctrlKey && e.shiftKey) {
    const key = e.key.toLowerCase()
    if (key === 'v') {
      // Paste text from clipboard on ctrl+shift+v
      navigator.clipboard
        .readText()
        .then(sendInput)
        .catch((error) => term.writeln(`\r\n[paste failed: ${error.message}]`))
      return false
    } else if (key === 'c' || key === 'x') {
      // Copy selected text on ctrl+shift+c/x
      navigator.clipboard
        .writeText(term.getSelection())
        .catch((error) => term.writeln(`\r\n[copy failed: ${error.message}]`))
      term.focus()
      return false
    }
  }
  return true
})

// onKey, not onData: onData also carries xterm's automatic replies to
// device queries (e.g. cursor position), which every peer would send.
term.onKey((e) => sendInput(e.key))

Edrys.onMessage(({ subject, body }) => {
  if (subject === SUBJECT_READ) {
    term.write(body)
  } else if (subject === SUBJECT_WRITE && Edrys.role === 'station') {
    serialWrite(body)
  }
}, true)

// ---------------------------------------------------------------------
// Serial connection (station only)

let port = null
let writer = null

async function serialConnect(baudRate) {
  if (port) return

  const requested = await navigator.serial.requestPort()
  await requested.open({ baudRate })
  port = requested
  serialRead()
}

async function serialRead() {
  // Errors like BreakError or FramingError (wrong baud, device reset)
  // only end the current stream; port.readable is replaced afterwards,
  // so keep reading until the port itself is gone.
  while (port && port.readable) {
    const textDecoder = new TextDecoderStream()
    const readableStreamClosed = port.readable
      .pipeTo(textDecoder.writable)
      .catch(() => {})
    const reader = textDecoder.readable.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        if (value) Edrys.sendMessage(SUBJECT_READ, value)
      }
    } catch (error) {
      Edrys.sendMessage(SUBJECT_READ, `\n[serial error: ${error.message}]\n`)
    } finally {
      reader.releaseLock()
    }
    await readableStreamClosed
  }
  port = null
  setStatus('off')
}

function serialClose() {
  setStatus('off')
  window.location.reload()
}

async function serialWrite(text) {
  if (!port) return
  if (!writer) {
    const textEncoder = new TextEncoderStream()
    textEncoder.readable.pipeTo(port.writable).catch(() => {})
    writer = textEncoder.writable.getWriter()
  }
  try {
    await writer.write(text)
  } catch (error) {
    Edrys.sendMessage(SUBJECT_READ, `\n[write failed: ${error.message}]\n`)
  }
}

// ---------------------------------------------------------------------
// Status

let warnedDisconnected = false
let lastState = null

function setStatus(state, baud = null) {
  if (!Edrys.ready) return
  Edrys.getState(STATUS_KEY, 'Value', { state, baud })
}

function getStatus() {
  if (!Edrys.ready) return null
  return Edrys.getState(STATUS_KEY, 'Value') || { state: 'off' }
}

function renderStatus() {
  const status = getStatus()
  if (!status) return
  const badge = document.getElementById('badge')
  badge.className = 'badge ' + status.state
  badge.textContent =
    STATUS_TEXT[status.state] +
    (status.state === 'on' && status.baud ? ` · ${status.baud} baud` : '')
  if (status.state === 'on') warnedDisconnected = false

  // Explain the state in the terminal, once per change
  if (status.state !== lastState) {
    writeStatusMessage(status, lastState)
    lastState = status.state
  }
}

function writeStatusMessage(status, previous) {
  if (status.state === 'on') {
    term.writeln(`\r\nDevice connected (${status.baud} baud).`)
    term.writeln('Copy with ctrl+shift+x, paste with ctrl+shift+v.\r\n')
  } else if (status.state === 'off') {
    if (previous === 'on') term.writeln('\r\n[device disconnected]')
    term.writeln(
      Edrys.role === 'station'
        ? 'No device connected. Choose a baud rate and click Connect.'
        : 'Waiting for the station to connect a device…'
    )
  }
}

// Called on input: tell the user once that nothing will reach the
// device, instead of dropping keystrokes silently.
function warnIfDisconnected() {
  const status = getStatus()
  if (!status || status.state === 'on' || warnedDisconnected) return
  warnedDisconnected = true
  term.writeln('\r\n[no device connected at the station, input is not sent]')
}

// ---------------------------------------------------------------------
// Config

// Configs stay strings when they are not valid JSON, or may be null
function asObject(config) {
  return config && typeof config === 'object' ? config : {}
}

// stationConfig is the documented place; config is read for classes
// set up before the schema existed.
function configuredBaud() {
  const baud = parseInt(
    asObject(Edrys.module.stationConfig).baud ??
      asObject(Edrys.module.config).baud
  )
  return baud > 0 ? baud : null
}

// Select a baud rate, adding it to the list if it is not a preset
// (e.g. 74880 or 250000)
function selectBaud(select, baud) {
  const value = String(baud)
  if (![...select.options].some((option) => option.value === value)) {
    select.add(new Option(value, value))
  }
  select.value = value
}

// ---------------------------------------------------------------------
// Init

Edrys.onReady(() => {
  // onUpdate fires on any room change; reading one value is cheap
  Edrys.onUpdate(renderStatus)

  if (Edrys.role === 'station') {
    // After a reload the port is closed, whatever the state says
    setStatus('off')

    document.getElementById('station-controls').hidden = false

    // Baud rate from config, then the last choice on this station
    const baudSelect = document.getElementById('baud')
    selectBaud(
      baudSelect,
      configuredBaud() || parseInt(Edrys.getItem('baud')) || DEFAULT_BAUD
    )
    baudSelect.addEventListener('change', () => {
      Edrys.setItem('baud', baudSelect.value)
    })

    const connectBtn = document.getElementById('connect-btn')
    const disconnectBtn = document.getElementById('disconnect-btn')
    connectBtn.addEventListener('click', async () => {
      const baudRate = parseInt(baudSelect.value)
      connectBtn.disabled = true
      setStatus('wait')
      try {
        await serialConnect(baudRate)
        setStatus('on', baudRate)
        // Swap the connect controls for the disconnect button
        baudSelect.disabled = true
        connectBtn.hidden = true
        disconnectBtn.hidden = false
        port.addEventListener('disconnect', serialClose)
      } catch (error) {
        // e.g. the port picker was cancelled or the port is busy
        setStatus('off')
        term.writeln(`\r\n[could not connect: ${error.message}]`)
      } finally {
        connectBtn.disabled = false
      }
    })

    disconnectBtn.addEventListener('click', serialClose)
  }

  renderStatus()
})
