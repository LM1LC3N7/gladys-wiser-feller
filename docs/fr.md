# Wiser by Feller

Cette intégration relie Gladys à **votre µGateway Wiser by Feller** par son
**API locale officielle**, et propose les sorties de votre installation dans
l'onglet **Découverte** de Gladys : lumières, variateurs, prises commandées,
stores, volets et stores bannes, ainsi que vos **scènes Wiser** et les **appuis
sur les boutons** enregistrés sur le µGateway. Une fois un appareil ajouté, son
état suit le µGateway **en direct**, et Gladys le pilote à travers lui. Tout
reste sur votre réseau local : aucun cloud. Non officiel, sans lien avec Feller
AG.

> **Version de développement (0.1).** Écrite à partir de la documentation de
> l'API de Feller et de la bibliothèque aiowiserbyfeller, et testée contre un
> µGateway simulé : module **jamais testé avec un vrai µGateway** pour
> l'instant. Vos retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

| Sortie Wiser                               | Dans Gladys                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Interrupteur (lumière)                     | une lumière : allumage                                                                         |
| Variateur (LED, DALI)                      | une lumière : allumage et luminosité (0-100 %)                                                 |
| Interrupteur réglé en « prise » dans l'app | un interrupteur : marche/arrêt                                                                 |
| Store à lamelles                           | un volet : ouvrir, fermer, arrêter, position ; les **lamelles** en appareil séparé, sur option |
| Volet roulant, moteur                      | un volet : ouvrir, fermer, arrêter, position                                                   |
| Store banne                                | un rideau : ouvrir, fermer, arrêter, position                                                  |
| Moteur à relais simple                     | un volet : ouvrir, fermer, arrêter (sans position)                                             |
| Sortie à impulsion ou minuterie d'escalier | un état en lecture seule et un bouton « Activer », **désactivé par défaut**                    |
| Scène Wiser                                | un bouton « Lancer » : la scène s'exécute comme depuis l'app                                   |
| Bouton enregistré sur le µGateway          | un bouton : chaque appui arrive à vos scènes Gladys                                            |

Les stores et volets ne sont **jamais** des interrupteurs : une scène « tout
éteindre » ne les ferme pas. La position suit la convention de Gladys :
100 % = ouvert, 0 % = fermé. Pendant qu'un moteur apprend ses fins de course
(calibrage), sa position est inconnue et n'est pas envoyée.

Une sortie marche/arrêt n'est une lumière ou un interrupteur que si elle n'a
**aucun sous-type** : une sortie réglée en impulsion, en minuterie ou avec tout
autre sous-type devient une sortie à impulsion (lecture seule, bouton derrière
l'option). Si vous réglez une sortie en impulsion **après** l'avoir ajoutée
(dans l'app eSetup), cliquez sur **Scanner** dans l'onglet Découverte, puis
**supprimez l'appareil et ajoutez-le à nouveau** : ses anciennes commandes de
lumière sont refusées d'ici là.

Une **scène Wiser** qui commande une sortie à impulsion est protégée comme
elle : refusée tant que l'option n'est pas activée (relue juste avant l'envoi),
et au moins 3 secondes entre deux impulsions de la même sortie, qu'elles
viennent de la scène ou du bouton « Activer ». Une scène qui lance des scripts
est protégée de même dès qu'une sortie à impulsion existe.

Les appareils sont nommés d'après le nom de la sortie et sa pièce dans l'app
Wiser (« Plafonnier (Salon) »). Leur identifiant suit l'adresse physique de la
sortie (module et canal) : il ne change pas si le µGateway renumérote ses
sorties. Les sorties de chauffage (HVAC), les couleurs et la température de
blanc des DALI ne sont pas encore pilotées.

### Boutons et déclencheurs de scène

Le µGateway (génération B, micrologiciel 6.0.41 ou plus récent) envoie les
appuis des boutons **enregistrés** (« managed buttons ») par son WebSocket.
Chaque bouton enregistré devient un appareil Gladys dont la fonctionnalité
« Appui » prend une valeur par appui : appui court, appui long, relâché, en
distinguant haut/bas et marche/arrêt sur une bascule. Utilisez-la comme
déclencheur « Changement d'état d'un appareil » dans une scène. Deux appuis de
suite donnent deux événements. Gladys n'enregistre pas de bouton elle-même (ce
serait modifier la configuration du µGateway) : enregistrez-les par l'API du
µGateway (`POST /api/buttons`) ou un outil qui le fait, puis cliquez sur
**Scanner** dans l'onglet Découverte. Les µGateway de génération A n'envoient
pas ces appuis.

## Prérequis

- Un µGateway Wiser by Feller sur le même réseau local que Gladys, avec son
  adresse IP (de préférence fixe, réservée dans votre box).
- Un accès physique au µGateway pour appuyer sur l'un de ses boutons une fois,
  au moment d'obtenir le jeton.

## Installation

1. Dans Gladys, ouvrez l'intégration **Wiser by Feller**, onglet
   **Configuration**.
2. Saisissez l'**adresse IP** du µGateway (par exemple `192.168.1.20`) et
   enregistrez.
3. Cliquez sur **Obtenir le jeton**. Les boutons du µGateway clignotent pendant
   30 secondes : **appuyez sur l'un d'eux**. Le jeton est enregistré tout seul
   dans le champ « Jeton du µGateway » et Gladys se connecte.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

Le bouton n'envoie **qu'une demande par clic**, jamais en boucle. Sans appui
dans les 30 s, rien ne change : cliquez à nouveau. Chaque nouveau jeton remplace
le précédent (le µGateway invalide l'ancien).

Le jeton du compte « gladys » part d'une copie du compte Wiser choisi dans
« Compte Wiser à recopier » (`admin`, celui de l'app Wiser Home, par défaut) :
noms, pièces et scènes viennent de lui.

## Options

- **Mises à jour en direct** (activé par défaut) : Gladys écoute le WebSocket du
  µGateway ; les états suivent en une seconde et les appuis sur les boutons
  arrivent. Les états sont aussi relus toutes les 5 minutes, et la liste des
  sorties, scènes et boutons toutes les 30 minutes (ou avec **Scanner** dans
  l'onglet Découverte).
- **Intervalle de lecture** (30 s par défaut, 10 à 3600 s) : sans le direct
  (désactivé ou perdu), les états sont lus à ce rythme.
- **Autoriser les sorties à impulsion et minuterie** (désactivé par défaut) :
  une sortie « impulsion » ou « minuterie d'escalier » commande souvent un
  ouvre-porte de garage ou une gâche. Tant que l'option est désactivée, son
  bouton « Activer » est refusé, et l'option est relue juste avant chaque
  envoi. Deux impulsions sont espacées d'au moins 3 secondes.
- **Lamelles des stores en appareil séparé** (désactivé par défaut) : chaque
  store à lamelles propose aussi un appareil « <store> – Lamelles » (0-100 %).
  Attention : un « fermer tous les stores » de Google, Alexa, HomeKit ou d'un
  assistant (MCP) peut aussi viser cet appareil.
- **Langue des noms des fonctionnalités** : français ou anglais.

Si le WebSocket ne dit plus rien pendant 10 minutes, Gladys le rouvre (un
µGateway qui le coupe sans prévenir) ; dans une maison calme, cela ne coûte
qu'une reconnexion. Une socket qui s'ouvre puis se coupe aussitôt garde un délai
de reprise croissant (jusqu'à 2 minutes), et les états ne sont jamais lus plus
d'une fois par intervalle.

## Sécurité et vie privée

- Le jeton est **gardé par Gladys dans sa base, jamais réaffiché, et envoyé
  seulement à l'adresse saisie** (en en-tête `Authorization`). Il n'apparaît
  jamais dans les journaux. Les redirections ne sont jamais suivies.
- Un jeton refusé par le µGateway n'est **jamais réessayé automatiquement**,
  même après un redémarrage : Gladys attend que vous obteniez un nouveau jeton
  ou cliquiez sur **Tester la connexion**.
- Une demande « 429 » du µGateway met tout en pause (1 minute à 6 heures).
- Les commandes partent une par une par sortie, dans les 3,5 s, ou sont
  refusées. Une commande qui a pu partir sans réponse (erreur 5xx, réponse
  illisible, délai dépassé après l'envoi) est annoncée « envoyée, sans
  confirmation » et la sortie est relue ; un refus du µGateway (4xx) est dit
  « refusée » ; un µGateway injoignable avant l'envoi donne « non envoyée ».

## Dépannage

- **« Le µGateway a refusé le jeton »** : cliquez sur **Obtenir le jeton** et
  appuyez sur un bouton du µGateway.
- **« Injoignable »** : vérifiez l'adresse IP (pas de nom en `.local`, que le
  conteneur ne résout pas) et que le µGateway est sous tension.
- **Pas de mises à jour en direct** : les états sont lus à l'intervalle choisi ;
  le badge de l'appareil l'indique par un point orange.
- **Tester la connexion** affiche le modèle, le micrologiciel, le nombre de
  sorties, de scènes et de boutons enregistrés, et l'état du direct.

## Crédits

Logique portée de [aiowiserbyfeller](https://github.com/Syonix/aiowiserbyfeller)
(Apache-2.0) et de l'intégration Home Assistant
[ha-wiser-by-feller](https://github.com/Syonix/ha-wiser-by-feller) (Apache-2.0),
d'après la documentation de l'API publiée par Feller AG. Wiser by Feller est
une marque de Feller AG ; ce projet est sans lien avec Feller AG.
