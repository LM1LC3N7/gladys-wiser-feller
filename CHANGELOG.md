# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-18

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

### Changed

- The slats of venetian blinds are a device of their own ("<blind> – Slats"),
  published only with the new "Slats of venetian blinds as their own device"
  option (off by default): a "close all blinds" of a voice assistant may
  target it too.
- Command failures told precisely: "refused" for a refusal of the µGateway,
  "sent, without confirmation" (read back) once the request may have left,
  "not sent" when the µGateway could not be reached.
- A socket accepted then cut at once keeps growing retry delays, and the
  states are never read more than once per interval; a socket silent for 10
  minutes is opened again.
- The button presses no longer starve the states of the lights and blinds.

### Security

- Any sub-type of an on/off output other than none (written in any case or
  with spaces) makes it an impulse output, read-only unless allowed.
- A Wiser scene that drives an impulse output is guarded like it (option,
  read again before sending, 3 s apart).
- A token that does not look like one is never sent; only explicit refusals
  of the µGateway count as a refused token.
- An impulse output and the Wiser scenes that drive it share the 3 s spacing:
  a scene and a direct impulse can no longer leave a few ms apart. Scenes
  running scripts are guarded as soon as an impulse output exists.
- After a change of address, the Discovery is emptied at once; the presses
  keep a share of the state budget; an unsaved claimed token survives a save
  of the form that still holds the old one.

[Unreleased]: https://github.com/LM1LC3N7/gladys-wiser-feller/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-wiser-feller/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-wiser-feller/releases/tag/v0.1.1
