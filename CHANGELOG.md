# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The outputs of a Wiser by Feller µGateway, offered in the Discovery tab:
  lights (on/off), dimmers and DALI lights (brightness), switched outlets,
  venetian blinds (position and slats), roller shutters and motors
  (position), awnings (as curtains), relay motors (open, close, stop). Blinds
  are never switches.
- Wiser scenes as "Run" buttons (the job of the scene), and the presses of the
  buttons registered on the µGateway as button events (short, long, release;
  up/down and on/off told apart), usable as scene triggers.
- A "Get the token" button: one claim per click, the µGateway answering once
  one of its buttons is pressed; the token saved in the secret field, sent
  only to the address typed, never logged.
- Live updates through the WebSocket of the µGateway, the states read again
  every 5 minutes and the inventory every 30 minutes; reads at a configurable
  pace without the socket; a watchdog that reopens a deaf socket.
- Commands one at a time per output, sent within 3.5 s or refused; a command
  that may have left without an answer is told "sent, without confirmation"
  and read back.
- Impulse and staircase-timer outputs read-only by default, with an option to
  allow their "Activate" button (read again when the request leaves, 3 s
  between two impulses).
- A refused token is never tried again automatically, even after a restart;
  a 429 pauses every path; both kept in `/data`.
- Transport badges, a "Test the connection" button, English and French texts.

[Unreleased]: https://github.com/LM1LC3N7/gladys-wiser-feller/commits/main
