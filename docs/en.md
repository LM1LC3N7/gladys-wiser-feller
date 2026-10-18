# Wiser by Feller

This integration connects Gladys to **your Wiser by Feller µGateway** through
its **official local API**, and offers the outputs of your installation in the
**Discovery** tab of Gladys: lights, dimmers, switched outlets, venetian
blinds, shutters and awnings, as well as your **Wiser scenes** and the
**presses of the buttons** registered on the µGateway. Once a device is added,
its state follows the µGateway **live**, and Gladys controls it through it.
Everything stays on your local network: no cloud. Unofficial, not affiliated
with Feller AG.

> **Development version (0.1).** Written from Feller's API documentation and
> the aiowiserbyfeller library, and tested against a simulated µGateway: it
> has never been tested with a real µGateway yet. Feedback is welcome on the
> GitHub repository.

## What you get

| Wiser output                      | In Gladys                                                       |
| --------------------------------- | --------------------------------------------------------------- |
| Switch (light)                    | a light: on/off                                                 |
| Dimmer (LED, DALI)                | a light: on/off and brightness (0-100 %)                        |
| Switch set as "outlet" in the app | a switch: on/off                                                |
| Venetian blind                    | a shutter: open, close, stop, position, and **slats** (0-100 %) |
| Roller shutter, motor             | a shutter: open, close, stop, position                          |
| Awning                            | a curtain: open, close, stop, position                          |
| Plain relay motor                 | a shutter: open, close, stop (no position)                      |
| Impulse or staircase-timer output | a read-only state and an "Activate" button, **off by default**  |
| Wiser scene                       | a "Run" button: the scene runs as from the app                  |
| Button registered on the µGateway | a button: every press reaches your Gladys scenes                |

Blinds and shutters are **never** switches: a "turn everything off" scene does
not close them. The position follows the Gladys convention: 100 % = open, 0 %
= closed. While a motor learns its end positions (calibration), its position
is unknown and not sent.

Devices are named after the output and its room in the Wiser app ("Ceiling
(Living room)"). Their id follows the physical address of the output (module
and channel): it does not change if the µGateway renumbers its outputs. HVAC
outputs, and the colours and white temperature of DALI lights, are not
controlled yet.

### Buttons and scene triggers

The µGateway (generation B, firmware 6.0.41 or later) sends the presses of the
**registered** ("managed") buttons over its WebSocket. Each registered button
becomes a Gladys device whose "Press" feature takes one value per press: short
press, long press, release, telling up/down and on/off apart on a rocker. Use
it as a "Device state change" trigger in a scene. Two presses in a row are two
events. Gladys does not register buttons itself (that would change the
configuration of the µGateway): register them through the API of the µGateway
(`POST /api/buttons`) or a tool that does it, then click **Scan** in the
Discovery tab. Generation A µGateways do not send these presses.

## Requirements

- A Wiser by Feller µGateway on the same local network as Gladys, and its IP
  address (preferably fixed, reserved in your router).
- Physical access to the µGateway to press one of its buttons once, when
  getting the token.

## Setup

1. In Gladys, open the **Wiser by Feller** integration, **Configuration** tab.
2. Type the **IP address** of the µGateway (like `192.168.1.20`) and save.
3. Click **Get the token**. The buttons of the µGateway blink for 30 seconds:
   **press one of them**. The token is saved in the "Token of the µGateway"
   field by itself and Gladys connects.
4. Open the **Discovery** tab and add the devices you want.

The button sends **one request per click**, never in a loop. Without a press
within 30 s nothing changes: click again. Each new token replaces the previous
one (the µGateway invalidates the old one).

The token of the "gladys" account starts as a copy of the Wiser account chosen
in "Wiser account to copy" (`admin`, the one of the Wiser Home app, by
default): names, rooms and scenes come from it.

## Options

- **Live updates** (on by default): Gladys listens to the WebSocket of the
  µGateway; the states follow within a second and the button presses arrive.
  The states are also read every 5 minutes, and the list of outputs, scenes
  and buttons every 30 minutes (or with **Scan** in the Discovery tab).
- **Read interval** (30 s by default, 10 to 3600 s): without the live updates
  (off or lost), the states are read at this pace.
- **Allow impulse and timer outputs** (off by default): an "impulse" or
  "staircase timer" output often drives a garage door opener or a door
  strike. While the option is off, its "Activate" button is refused, and the
  option is read again just before each request. Two impulses are at least 3
  seconds apart.
- **Language of the feature names**: French or English.

## Security and privacy

- The token is **kept by Gladys in its database, never shown again, and sent
  only to the address typed** (in the `Authorization` header). It never
  appears in the logs. Redirections are never followed.
- A token refused by the µGateway is **never tried again automatically**, even
  after a restart: Gladys waits for you to get a new token or click **Test the
  connection**.
- A "429" of the µGateway pauses everything (1 minute to 6 hours).
- Commands leave one at a time per output, within 3.5 s, or are refused. A
  command that may have left without an answer is told "sent, without
  confirmation" and the output is read again.

## Troubleshooting

- **"The µGateway refused the token"**: click **Get the token** and press a
  button of the µGateway.
- **"Unreachable"**: check the IP address (no `.local` name, the container does
  not resolve them) and that the µGateway is powered.
- **No live updates**: the states are read at the chosen interval; the badge of
  the device shows it with an orange dot.
- **Test the connection** shows the model, the firmware, the number of
  outputs, scenes and registered buttons, and the state of the live updates.

## Credits

Logic ported from [aiowiserbyfeller](https://github.com/Syonix/aiowiserbyfeller)
(Apache-2.0) and the Home Assistant integration
[ha-wiser-by-feller](https://github.com/Syonix/ha-wiser-by-feller)
(Apache-2.0), after the API documentation published by Feller AG. Wiser by
Feller is a trademark of Feller AG; this project is not affiliated with Feller
AG.
