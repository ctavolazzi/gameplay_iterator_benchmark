// hands: press keys and click in one app's window, the way a person at the keyboard would.
// The real game window is driven with this, so everything it shows (inventory screens, tool
// swings) is the game's own picture of a player playing.
//
//   hands <pid> front                       bring the app to the front
//   hands <pid> key down|up <keycode>       hold or release a key
//   hands <pid> tap <keycode> [ms]          press a key for ms milliseconds (default 60)
//   hands <pid> move <x> <y>                move the pointer (screen points, from top left)
//   hands <pid> mouse down|up left|right <x> <y>
//   hands <pid> click left|right <x> <y> [shift]
//
// Every command first makes sure the app is in front, and refuses to send anything if it
// cannot be, so a key press never lands in some other window.
// Needs the Accessibility permission (System Settings, Privacy) for whatever runs it.

import AppKit
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3, let pid = Int32(args[1]) else { fail("usage: hands <pid> <command> ...") }
guard let app = NSRunningApplication(processIdentifier: pid) else { fail("no app with pid \(pid)") }

func bringToFront() {
  if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return }
  app.activate(options: [.activateIgnoringOtherApps])
  for _ in 0..<20 {
    usleep(50_000)
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { usleep(120_000); return }
  }
  fail("could not bring pid \(pid) to the front; nothing was sent")
}

let source = CGEventSource(stateID: .hidSystemState)

func key(_ code: CGKeyCode, down: Bool, shift: Bool = false) {
  guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { fail("could not make a key event") }
  if shift { event.flags = .maskShift }
  event.post(tap: .cghidEventTap)
}

func mouse(_ type: CGEventType, _ button: CGMouseButton, _ x: Double, _ y: Double, shift: Bool = false) {
  guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: button) else { fail("could not make a mouse event") }
  if shift { event.flags = .maskShift }
  event.post(tap: .cghidEventTap)
}

func number(_ index: Int) -> Double {
  guard args.count > index, let value = Double(args[index]) else { fail("expected a number at argument \(index)") }
  return value
}

let command = args[2]
bringToFront()

switch command {
case "front":
  break
case "key":
  guard args.count >= 5, let code = UInt16(args[4]) else { fail("usage: hands <pid> key down|up <keycode>") }
  key(code, down: args[3] == "down")
case "tap":
  guard args.count >= 4, let code = UInt16(args[3]) else { fail("usage: hands <pid> tap <keycode> [ms]") }
  let ms = args.count >= 5 ? UInt32(args[4]) ?? 60 : 60
  key(code, down: true)
  usleep(ms * 1000)
  key(code, down: false)
case "move":
  mouse(.mouseMoved, .left, number(3), number(4))
case "mouse":
  guard args.count >= 7 else { fail("usage: hands <pid> mouse down|up left|right <x> <y>") }
  let left = args[4] == "left"
  let down = args[3] == "down"
  let type: CGEventType = left ? (down ? .leftMouseDown : .leftMouseUp) : (down ? .rightMouseDown : .rightMouseUp)
  mouse(type, left ? .left : .right, number(5), number(6))
case "click":
  guard args.count >= 6 else { fail("usage: hands <pid> click left|right <x> <y> [shift]") }
  let left = args[3] == "left"
  let x = number(4), y = number(5)
  let shift = args.count >= 7 && args[6] == "shift"
  mouse(.mouseMoved, .left, x, y)
  usleep(90_000)
  if shift { key(56, down: true, shift: true); usleep(40_000) }
  mouse(left ? .leftMouseDown : .rightMouseDown, left ? .left : .right, x, y, shift: shift)
  usleep(70_000)
  mouse(left ? .leftMouseUp : .rightMouseUp, left ? .left : .right, x, y, shift: shift)
  if shift { usleep(40_000); key(56, down: false) }
default:
  fail("unknown command \(command)")
}
usleep(20_000)
