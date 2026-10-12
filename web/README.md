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
