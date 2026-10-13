# Watch — console web hors serveur

L'interface sous /web complète le projet original [Fieldwatch](https://github.com/OffGridPete/Fieldwatch) sans modifier le moteur de scan Android.

## Fonctions réellement disponibles
- import de fichiers CSV / JSON Lines / JSON, compatibles avec les journaux Fieldwatch (LogStore.kt)
- inventaire et dédoublonnage des radios par type et identifiant
- recherche, tri, filtres, statistiques, chronologie et positions relatives (hors ligne, sans tuiles réseau)
- export des observations filtrées en CSV et JSON
- protection de confidentialité activée par défaut : MAC et GPS masqués pour l'affichage et les exports dérivés
- interface responsive, PWA utilisable hors ligne après une première ouverture

## Fonctionnement

1. Sur Android, ouvrez Fieldwatch (Android 10+). Autorisez les scans Wi-Fi/BLE et lancez l'écoute native.
2. Dans Fieldwatch, allez à Reports → Log → Export et enregistrez un fichier CSV ou JSONL sur l'appareil.
3. Ouvrez la console web et importez votre fichier. L'importation précédente est remplacée par la sélection courante ; sélectionnez plusieurs fichiers ensemble pour agréger plusieurs journaux.
4. Analysez et exportez. Les données ne quittent pas le navigateur à moins de télécharger ou partager volontairement un export.

La page ne fait pas de détection Wi-Fi en direct : le navigateur n'expose pas les API Android nécessaires. Un transfert à la demande depuis la nouvelle APK Android vers la PWA existe via la feuille de partage système ; il ne s'agit pas d'un scan radio en direct. Les importations manuelles sont traitées en mémoire et les relevés ne sont pas envoyés à un serveur. Lors d'un partage Android, une copie temporaire est placée dans le cache privé du navigateur jusqu'à sa consommation, avec suppression à la lecture et expiration contrôlée au prochain réveil du service worker.

## Développement et vérification

La console est une application statique sans dépendance JavaScript ni service central.
Depuis la racine : `node --test web/tests/*.test.mjs`.
Pour lancer localement : `python3 -m http.server 8000 --directory web` puis ouvrir http://localhost:8000/ .

Site public déployé : https://watch-fieldwatch.shipstatic.com (hébergement statique ShipStatic, plan gratuit connecté). Le workflow .github/workflows/web.yml exécute les vérifications sans dépendre de l'activation initiale de GitHub Pages. Les modifications futures sur GitHub ne redéploient pas automatiquement ShipStatic. Le dossier web/ reste publiable sur GitHub Pages après activation manuelle du service.

## Sécurité et attribution

La provenance, la licence MIT originale et le fichier NOTICE restent dans la racine du dépôt. Les tables IEEE/Bluetooth SIG conservent leurs conditions de réutilisation propres. La position GPS décrit l'endroit du téléphone lors de l'écoute, et ne permet pas d'affirmer la position exacte d'une radio.


## Liaison Android → Watch web via partage natif

La nouvelle APK contient, dans **Reports → Log export**, un bouton **Send observations to Watch web** :
- une confirmation rappelle que les identifiants radio complets et le GPS peuvent être présents ;
- l'application génère automatiquement le journal JSONL via `LogStore.exportBundle` ;
- le partage système Android laisse l'utilisateur choisir explicitement Watch web ou un autre destinataire, avec une autorisation FileProvider en lecture ;
- aucun service de synchronisation ou transfert en arrière-plan n'est ajouté.

Pour recevoir le fichier, **installez la PWA depuis Chrome Android** (menu ⋮ → Ajouter à l'écran d'accueil → Installer). Le manifeste Web Share Target déclare les formats CSV/JSONL/JSON. Un service worker intercepte localement le POST multipart : le fichier partagé n'est **jamais envoyé à un serveur**. Il transite par un cache privé éphémère et est supprimé dès la consommation. Un élément inutilisé de plus de 10 minutes sera supprimé à l'activation suivante du service worker (la suppression n'est pas garantie à l'instant exact des 10 minutes).

**Compatibilité** : une régression de Chrome Android 153 a fait disparaître les fichiers du partage WebAPK. Chromium a déclaré le correctif vérifié notamment dans Chrome 154.0.8037.57 et 155.0.8059.16 (voir [incident Chromium 561685220](https://issuetracker.google.com/issues/561685220)). Sur un navigateur non corrigé, le bouton **Importer** du site reste disponible. Un navigateur sans support Web Share Target ne pourra pas recevoir directement les partages Android.

**Ce pont est à la demande, en un geste**, et non un flux Wi-Fi/BLE live. L'APK d'origine de Fieldwatch dans `dist/` ne contient pas ce bouton ; il faut installer un build APK généré à partir de ce dépôt. Le partage depuis la nouvelle application n'est pas testé sur appareil réel à ce stade.

**Licences** : le code et les attributions MIT d'origine restent dans LICENSE et NOTICE.

## Installation parallèle à Fieldwatch officiel

L'identifiant Android du fork est `app.watch.fieldwatch` et son libellé « Watch Fieldwatch ». Il peut donc être installé **à côté** de Fieldwatch officiel (`app.fieldwatch`) sans conflit de certificat ou suppression des données de l'application d'origine. Les deux applications disposent de journaux isolés et ne partagent pas automatiquement les données. Il faut enregistrer de nouveaux relevés dans Watch Fieldwatch avant d'utiliser le nouveau bouton de partage. Les nouveaux builds GitHub Actions sont des APK de test signées pour le debug, pas des publications signées officiellement par Off Grid Pete LLC.

## Corrections de robustesse et de confidentialité

- Les exports JSON avec Confidentialité active masquent la MAC, retirent la position et suppriment désormais aussi la clé interne `kind:MAC`, qui divulguait auparavant l'identifiant complet.
- L'URL interne du cache de réception ne peut plus être lue par une requête GET interceptée par le service worker ; seules les ressources publiques du cache statique sont servies.
- Le rendu des positions GPS utilise des bornes géographiques calculées en O(n) sans spread et un échantillonnage de dessin plafonné à 12 000 points, pour supporter les gros journaux.
- Les horodatages hors limites ne provoquent plus d'exception lors d'un export CSV.

## Fidélité export → réimport

L'interface accepte les formats originaux Fieldwatch et ses propres exports Watch. Les colonnes CSV `firstSeen`/`lastSeen`, normalisées en minuscules par le parseur, ainsi que les coordonnées `position.lat/lon` des JSON Watch, sont préservées à la réimportation. Des tests de régression contrôlent aussi que les exports masqués ne réintroduisent pas les positions GPS.

## Publication Android stable

La procédure de signature privée et de publication reproductible est dans [docs/watch-android-release.md](../docs/watch-android-release.md). Elle nécessite quatre secrets GitHub configurés une seule fois. En leur absence, seule l’APK de test provenant d’Android CI est disponible ; elle ne garantit pas les mises à jour sans réinstallation.

## Importation optimisée pour Android

Le décodage et le regroupement des journaux Wi-Fi/Bluetooth sont réalisés dans un **Web Worker dédié** lorsque le navigateur le permet, afin de ne pas bloquer les boutons et la navigation pendant le traitement de gros fichiers. Les fichiers restent sur l'appareil. La page ne conserve après import que les radios agrégées, le total d'observations et les comptages quotidiens ; les 250 000 observations brutes ne sont plus copiées dans l'interface. L'import de plusieurs fichiers est atomique : si un fichier est invalide, les données de la session précédente restent intactes. Les navigateurs sans module Worker conservent un mode de repli local.

Les plafonds restent 20 fichiers par import, 40 Mo par fichier, 80 Mo au total et 250 000 observations. Le worker et son processeur sont préchargés pour une utilisation hors ligne après installation de la PWA.

## Test réel de la console dans Chromium

Le workflow `Web checks` effectue maintenant, en plus des tests de parseur, un test complet dans un navigateur Chromium avec écran simulant un téléphone Android. Il vérifie l'importation par le Web Worker, le filtrage, les détails radio, la confidentialité des exports JSON, la conservation des données lors d'une erreur d'importation, le rendu des positions, la réception d'un fichier multipart via le vrai service worker et le rechargement hors ligne. Il n'utilise que des observations radio synthétiques et sauvegarde une capture d'écran uniquement en cas d'échec. Pour exécuter ce test en local : `npm --prefix web/e2e install --ignore-scripts --no-package-lock` puis `WATCH_CHROME_BIN=$(command -v chromium || command -v google-chrome) node web/e2e/smoke.mjs`.

## Confidentialité renforcée des exports

Un export avec **Confidentialité** activée remplace les identifiants radio par des alias opaques et distincts (du type WATCH-UUID-000001) sans dériver le pseudonyme de la MAC d'origine. Cela élimine les collisions dues au simple masquage des derniers octets lors de la réimportation. Chaque export utilise une nouvelle valeur aléatoire, empêchant la corrélation directe entre deux fichiers anonymisés. Les coordonnées GPS sont supprimées des exports, les éventuelles occurrences littérales de la MAC dans les champs texte sont masquées et **le graphique GPS n'est plus affiché tant que Confidentialité est activée**. Les données originales restent dans la session locale uniquement.

## Stockage des exports Android

Dans l'application Android **Watch Fieldwatch**, les fichiers temporaires de partage CSV/JSONL sont maintenant produits dans le **cache privé** `cache/export/`, compatible avec le `FileProvider`. L'application nettoie automatiquement les exports périmés (plus de 24 heures) lors de son ouverture et des exports suivants. Elle limite également le nombre d'anciens exports conservés, tout en préservant pendant une courte période les fichiers récemment proposés dans le menu de partage. Cette stratégie évite que chaque partage répété conserve une nouvelle copie persistante des journaux.

L'action explicite « Effacer les journaux » supprime aussi les exports radio temporaires du cache. Les fichiers que l'utilisateur a déjà volontairement copiés ou sauvegardés ailleurs restent à sa charge : ils ne sont pas supprimés automatiquement. Les copies précédemment générées par les anciennes versions sous le dossier interne `files/logs/` sont également éligibles au nettoyage progressif. Android peut supprimer des fichiers de cache plus tôt en cas de manque d'espace : il faut donc sauvegarder un export que l'on souhaite conserver durablement.

**Aucun archivage silencieux** : les actions de partage des journaux, cartes GPS et relevés de session (« sit ») ne copient désormais plus automatiquement les fichiers vers l'espace externe spécifique à l'application. Utilisez explicitement une action « Save / Enregistrer » pour conserver une copie durable dans un dossier choisi. Les anciennes versions ont pu créer des copies dans `Android/data/app.watch.fieldwatch/files/` ; elles ne sont pas effacées par cette migration afin d'éviter de supprimer des archives potentiellement utiles. Vérifiez-les manuellement si l'espace libre ou la confidentialité sont importants.

## Fiabilité de la rotation des journaux Android

Le dossier interne stocke douze segments numérotés `fieldwatch-000.jsonl` à `fieldwatch-011.jsonl`. Ils forment un anneau : leur ordre numérique **n'est pas** leur ordre d'enregistrement. L'application retrouve désormais au démarrage le segment JSONL modifié le plus récemment, et ordonne les relectures par modification réelle. Si le dernier fichier était déjà plein, une nouvelle tranche est sélectionnée **avant** l'ajout d'une observation. Les exports temporaires et les fichiers mal nommés ne sont pas interprétés comme des segments. Ces comportements sont vérifiés avec des fichiers réels créés dans les tests Kotlin.

## Fiabilité des observations Android

La fusion des radios lors de la relecture ne dépend plus de l'ordre physique des fichiers : les informations variables (nom, RSSI, canal et coordonnées) sont retenues de la ligne ayant le timestamp le plus récent. Une observation plus ancienne peut seulement compléter un champ manquant et contribuer aux compteurs/historiques. Trois tests Kotlin couvrent l'ordre JSONL inversé, le CSV dans les deux ordres et les métadonnées manquantes. L'horodatage ISO des lignes est aussi construit sous le verrou d'écriture pour éviter la corruption lors de scans concurrents.

## Cohérence du journal pendant un export

Les nouvelles observations radio ne sont plus éliminées parce qu'un export est en cours : elles attendent le mutex d'export puis sont écrites. Une suppression explicite continue d'invalider les écritures préexistantes avec la génération du journal. Les coordonnées GPS sont validées comme une seule paire finie dans les limites WGS84 et ne sont jamais composées à partir de deux observations différentes. Trois tests Kotlin couvrent les données GPS incomplètes ou invalides. Le tampon d'entrée Android restant borné, cela ne supprime pas un éventuel risque de saturation en cas de scans plus rapides que leur traitement.
