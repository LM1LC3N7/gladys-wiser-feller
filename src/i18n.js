// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges, refusals, feature
// names), in English and French. Never put the token in one of them.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

/** Feature and device names, by key. */
const LABELS = {
  on: { en: 'On/off', fr: 'Allumage' },
  brightness: { en: 'Brightness', fr: 'Luminosité' },
  state: { en: 'State', fr: 'État' },
  position: { en: 'Position', fr: 'Position' },
  tilt: { en: 'Slats', fr: 'Lamelles' },
  impulse: { en: 'Activate', fr: 'Activer' },
  run: { en: 'Run', fr: 'Lancer' },
  press: { en: 'Press', fr: 'Appui' },
  scene: { en: 'Wiser scene', fr: 'Scène Wiser' },
  buttonOf: { en: 'Button', fr: 'Bouton' },
};

/** The label of a key in a language. */
export function label(key, language = 'fr') {
  return LABELS[key]?.[language] ?? LABELS[key]?.en ?? key;
}

/** One text of a { en, fr } pair, in a language. */
export const word = (pair, language = 'fr') => pair?.[language] ?? pair?.en ?? '';

const trim = (text) =>
  text.length > LIMITS.badgeMessage ? `${text.slice(0, LIMITS.badgeMessage - 1)}…` : text;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const GET_TOKEN = {
  en: 'click "Get the token" in the configuration, then press a button of the µGateway within 30 s',
  fr: 'cliquez sur « Obtenir le jeton » dans la configuration, puis appuyez sur un bouton du µGateway dans les 30 s',
};

/** Why the gateway is unreachable or refuses, with the hint that fits. */
function failure(err) {
  const reason = err?.message ?? 'unknown error';
  switch (err?.kind) {
    case 'auth':
      return {
        en: `The µGateway refused the token (${reason}). Gladys will not try it again by itself: ${GET_TOKEN.en}.`,
        fr: `Le µGateway a refusé le jeton (${reason}). Gladys ne le réessaiera pas d'elle-même : ${GET_TOKEN.fr}.`,
      };
    case 'rate':
      return {
        en: 'The µGateway asked to slow down (HTTP 429): everything is paused for a while.',
        fr: 'Le µGateway demande de ralentir (HTTP 429) : tout est en pause pour un moment.',
      };
    case 'notfound':
    case 'format':
    case 'redirect':
      return {
        en: `This address does not answer like a Wiser µGateway (${reason}). Type its IP address, like 192.168.1.20.`,
        fr: `Cette adresse ne répond pas comme un µGateway Wiser (${reason}). Saisissez son adresse IP, par exemple 192.168.1.20.`,
      };
    default:
      return {
        en: `The µGateway is unreachable: ${reason}. Check its IP address and that it is on. Retrying in a few seconds.`,
        fr: `Le µGateway est injoignable : ${reason}. Vérifiez son adresse IP et qu'il est allumé. Nouvel essai dans quelques secondes.`,
      };
  }
}

const CONFIG_ERRORS = {
  empty: {
    en: 'Type the IP address of your Wiser µGateway in the configuration, like 192.168.1.20.',
    fr: "Saisissez l'adresse IP de votre µGateway Wiser dans la configuration, par exemple 192.168.1.20.",
  },
  invalid: {
    en: 'The address of the µGateway is not valid: type its IP address, like 192.168.1.20.',
    fr: "L'adresse du µGateway n'est pas valide : saisissez son adresse IP, par exemple 192.168.1.20.",
  },
  https: {
    en: 'The µGateway answers in plain http:// on your network: type its IP address alone, like 192.168.1.20.',
    fr: 'Le µGateway répond en http:// simple sur votre réseau : saisissez seulement son adresse IP, par exemple 192.168.1.20.',
  },
  credentials: {
    en: 'The address must not contain a user name nor a password.',
    fr: "L'adresse ne doit contenir ni nom d'utilisateur ni mot de passe.",
  },
  path: {
    en: 'Type the address of the µGateway alone, like 192.168.1.20 (no path, no ?…).',
    fr: "Saisissez l'adresse du µGateway seule, par exemple 192.168.1.20 (sans chemin ni ?…).",
  },
  'local-name': {
    en: 'Names ending in .local do not resolve in the integration container: type the IP address of the µGateway.',
    fr: "Les noms en .local ne sont pas résolus dans le conteneur de l'intégration : saisissez l'adresse IP du µGateway.",
  },
  'no-token': {
    en: `No token yet: save the address, then ${GET_TOKEN.en}.`,
    fr: `Pas encore de jeton : enregistrez l'adresse, puis ${GET_TOKEN.fr}.`,
  },
  'bad-token': {
    en: `The token in the configuration does not look like a token of the µGateway (spaces or unexpected characters): it is not sent. ${GET_TOKEN.en}.`,
    fr: `Le jeton de la configuration n'a pas la forme d'un jeton du µGateway (espaces ou caractères inattendus) : il n'est pas envoyé. Pour en obtenir un, ${GET_TOKEN.fr}.`,
  },
};

export const T = {
  configError: (error) => CONFIG_ERRORS[error] ?? CONFIG_ERRORS.invalid,
  connecting: {
    en: 'Connecting to the Wiser µGateway…',
    fr: 'Connexion au µGateway Wiser…',
  },
  failure,
  /** Connected: what is offered, and how the states follow. */
  connected({ loads, scenes, buttons }, liveState, pollInterval) {
    const en = [
      `Connected to the µGateway: ${plural(loads, 'output', 'outputs')}, ${plural(scenes, 'scene', 'scenes')}, ${plural(buttons, 'button', 'buttons')} offered in Discovery.`,
    ];
    const fr = [
      `Connecté au µGateway : ${plural(loads, 'sortie', 'sorties')}, ${plural(scenes, 'scène', 'scènes')}, ${plural(buttons, 'bouton', 'boutons')} proposés dans l'onglet Découverte.`,
    ];
    if (liveState === 'live') {
      en.push('Live updates on.');
      fr.push('Mises à jour en direct actives.');
    } else if (liveState === 'down') {
      en.push(`No live updates for now: the states are read every ${pollInterval} s.`);
      fr.push(
        `Pas de mises à jour en direct pour l'instant : les états sont lus toutes les ${pollInterval} s.`,
      );
    } else if (liveState === 'off') {
      en.push(`Live updates off: the states are read every ${pollInterval} s.`);
      fr.push(
        `Mises à jour en direct désactivées : les états sont lus toutes les ${pollInterval} s.`,
      );
    }
    return { en: en.join(' '), fr: fr.join(' ') };
  },
  badge: {
    noLive: (s) => ({
      en: trim(`No live updates from the µGateway: read every ${s} s.`),
      fr: trim(`Pas de mises à jour en direct du µGateway : lu toutes les ${s} s.`),
    }),
    unconfirmed: {
      en: 'Command sent, not confirmed by the µGateway yet.',
      fr: 'Commande envoyée, pas encore confirmée par le µGateway.',
    },
  },
  denied: {
    notCommand: {
      en: 'This feature cannot be controlled.',
      fr: 'Cette fonctionnalité ne peut pas être pilotée.',
    },
    notConnected: {
      en: 'The µGateway is not connected: command not sent.',
      fr: "Le µGateway n'est pas connecté : commande non envoyée.",
    },
    blocked: {
      en: 'The µGateway refused the token: command not sent. Get a new token in the configuration.',
      fr: 'Le µGateway a refusé le jeton : commande non envoyée. Obtenez un nouveau jeton dans la configuration.',
    },
    paused: {
      en: 'The µGateway asked to slow down: command not sent, try again in a moment.',
      fr: 'Le µGateway demande de ralentir : commande non envoyée, réessayez dans un moment.',
    },
    tooLate: {
      en: 'The command waited too long in the queue of this output: not sent.',
      fr: 'La commande a attendu trop longtemps dans la file de la sortie : non envoyée.',
    },
    notSent: (reason) => ({
      en: `The µGateway could not be reached (${reason}): command not sent.`,
      fr: `Le µGateway n'a pas pu être joint (${reason}) : commande non envoyée.`,
    }),
    unconfirmedScene: {
      en: 'Command sent to the µGateway, without confirmation.',
      fr: 'Commande envoyée au µGateway, sans confirmation.',
    },
    badValue: {
      en: 'Value not accepted for this feature: command not sent.',
      fr: 'Valeur non acceptée pour cette fonctionnalité : commande non envoyée.',
    },
    impulseOff: {
      en: 'Impulse and timer outputs are read-only: allow them in the configuration first.',
      fr: "Les sorties à impulsion et minuterie sont en lecture seule : autorisez-les d'abord dans la configuration.",
    },
    impulseBusy: {
      en: 'An impulse was just sent to this output: wait a few seconds.',
      fr: "Une impulsion vient d'être envoyée à cette sortie : patientez quelques secondes.",
    },
    unconfirmed: {
      en: 'Command sent to the µGateway, without confirmation: its state is read again.',
      fr: 'Commande envoyée au µGateway, sans confirmation : son état est relu.',
    },
    refused: (reason) => ({
      en: `The µGateway refused the command: ${reason}.`,
      fr: `Le µGateway a refusé la commande : ${reason}.`,
    }),
  },
  claim: {
    ok: {
      en: 'Token received and saved. Gladys connects to the µGateway with it now.',
      fr: 'Jeton reçu et enregistré. Gladys se connecte au µGateway avec lui maintenant.',
    },
    noButton: {
      en: 'No button of the µGateway was pressed within 30 s: click "Get the token" again and press one of its buttons while they blink.',
      fr: "Aucun bouton du µGateway n'a été pressé dans les 30 s : cliquez à nouveau sur « Obtenir le jeton » et appuyez sur l'un de ses boutons pendant qu'ils clignotent.",
    },
    busy: {
      en: 'A token request is already waiting for a press on the µGateway.',
      fr: 'Une demande de jeton attend déjà un appui sur le µGateway.',
    },
    saveFailed: {
      en: 'The µGateway gave a token but Gladys could not save it: it is used from memory until the integration restarts. Click "Get the token" again to save one.',
      fr: "Le µGateway a donné un jeton mais Gladys n'a pas pu l'enregistrer : il est utilisé en mémoire jusqu'au redémarrage de l'intégration. Cliquez à nouveau sur « Obtenir le jeton » pour en enregistrer un.",
    },
    unsaved: {
      en: 'The token in use could not be saved: it is lost at the next restart, get a new one.',
      fr: "Le jeton utilisé n'a pas pu être enregistré : il sera perdu au prochain redémarrage, obtenez-en un nouveau.",
    },
    failed: (err) => ({
      en: `No token: ${err?.message ?? 'unknown error'}. Check the address of the µGateway and click again.`,
      fr: `Pas de jeton : ${err?.message ?? 'erreur inconnue'}. Vérifiez l'adresse du µGateway et cliquez à nouveau.`,
    }),
  },
  test: {
    ok({ product, sw, api, loads, scenes, buttons, live }) {
      const en = [
        `Connection OK: µGateway ${product || '?'} (firmware ${sw || '?'}, API ${api || '?'}), ${plural(loads, 'output', 'outputs')}, ${plural(scenes, 'scene', 'scenes')}, ${plural(buttons, 'registered button', 'registered buttons')}.`,
      ];
      const fr = [
        `Connexion OK : µGateway ${product || '?'} (micrologiciel ${sw || '?'}, API ${api || '?'}), ${plural(loads, 'sortie', 'sorties')}, ${plural(scenes, 'scène', 'scènes')}, ${plural(buttons, 'bouton enregistré', 'boutons enregistrés')}.`,
      ];
      if (live?.ok) {
        en.push('Live updates: OK.');
        fr.push('Mises à jour en direct : OK.');
      } else if (live) {
        en.push(`Live updates: failed (${live.error?.message ?? 'unknown error'}).`);
        fr.push(`Mises à jour en direct : échec (${live.error?.message ?? 'erreur inconnue'}).`);
      }
      return { en: en.join(' '), fr: fr.join(' ') };
    },
  },
};
