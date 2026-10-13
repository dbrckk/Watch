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

La page ne fait pas de détection Wi-Fi en direct : le navigateur n'expose pas les API Android nécessaires. Un pont natif vers la page n'est pas implémenté dans cette version. Aucune donnée radio ni GPS n'est sauvegardée en localStorage, IndexedDB ou envoyée à un serveur. Les ressources statiques seules sont mises en cache.

## Développement et vérification

La console est une application statique sans dépendance JavaScript ni service central.
Depuis la racine : \`node --test web/tests/*.test.mjs\`.
Pour lancer localement : \`python3 -m http.server 8000 --directory web\` puis ouvrir http://localhost:8000/ .

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

**Compatibilité** : certains Chrome Android 153/154 (régression septembre 2026) livrent un formulaire de partage vide pour les WebAPK. Un message explicite demande alors d'utiliser le bouton Importer du site comme solution de repli. Un navigateur sans support Web Share Target ne pourra pas recevoir directement les partages Android.

**Ce pont est à la demande, en un geste**, et non un flux Wi-Fi/BLE live. L'APK d'origine de Fieldwatch dans `dist/` ne contient pas ce bouton ; il faut installer un build APK généré à partir de ce dépôt. Le partage depuis la nouvelle application n'est pas testé sur appareil réel à ce stade.

**Licences** : le code et les attributions MIT d'origine restent dans LICENSE et NOTICE.

## Installation parallèle à Fieldwatch officiel

L'identifiant Android du fork est `app.watch.fieldwatch` et son libellé « Watch Fieldwatch ». Il peut donc être installé **à côté** de Fieldwatch officiel (`app.fieldwatch`) sans conflit de certificat ou suppression des données de l'application d'origine. Les deux applications disposent de journaux isolés et ne partagent pas automatiquement les données. Il faut enregistrer de nouveaux relevés dans Watch Fieldwatch avant d'utiliser le nouveau bouton de partage. Les nouveaux builds GitHub Actions sont des APK de test signées pour le debug, pas des publications signées officiellement par Off Grid Pete LLC.

## Corrections de robustesse et de confidentialité

- Les exports JSON avec Confidentialité active masquent la MAC, retirent la position et suppriment désormais aussi la clé interne `kind:MAC`, qui divulguait auparavant l'identifiant complet.
- L'URL interne du cache de réception ne peut plus être lue par une requête GET interceptée par le service worker ; seules les ressources publiques du cache statique sont servies.
- Le rendu des positions GPS utilise des bornes géographiques calculées en O(n) sans spread et un échantillonnage de dessin plafonné à 12 000 points, pour supporter les gros journaux.
- Les horodatages hors limites ne provoquent plus d'exception lors d'un export CSV.
