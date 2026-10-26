# Signature et publication Android Watch

Ce document concerne uniquement le fork Watch (package Android : app.watch.fieldwatch), pas l'application originale Fieldwatch (app.fieldwatch).

## Pourquoi

Les APK de debug compilées par GitHub Actions utilisent une clé temporaire propre à l'environnement de build. Une APK compilée plus tard peut alors nécessiter une désinstallation préalable et effacer les données. Les versions de publication nécessitent une **clé privée de signature persistante**. Le workflow de publication vérifie cette signature avant de publier.

## Configuration simplifiée depuis Android (Termux)

La préparation des quatre secrets peut maintenant être exécutée **sur ton propre appareil**, sans les copier dans une discussion ou un fichier du dépôt :

1. Depuis Termux, exécute `pkg update && pkg install gh openjdk-17 coreutils curl`.
2. Connecte ton compte GitHub avec `gh auth login` et termine l'authentification dans le navigateur.
3. Récupère le script : `curl -fL https://raw.githubusercontent.com/dbrckk/Watch/main/scripts/setup-watch-signing.sh -o setup-watch-signing.sh`. Tu peux examiner le script avant son exécution.
4. Exécute `bash setup-watch-signing.sh --publish` et entre un mot de passe fort deux fois. Le script crée un keystore privé, le valide puis envoie les quatre valeurs à GitHub Actions avec le CLI officiel. Aucun mot de passe ni contenu de clé ne s'affiche. Sans `--publish`, il prépare la signature mais n'essaie jamais de publier.
5. Sauvegarde **hors de Termux et hors de GitHub** ton keystore indiqué par le script, ainsi que son mot de passe **à un endroit séparé**. Termux peut être désinstallé ou ses données effacées. Vérifie que tu peux récupérer cette copie.
6. Avec `--publish`, le script demande ensuite de saisir **BACKUP** pour confirmer qu'une sauvegarde indépendante existe. Sans cette confirmation, **aucune release n'est lancée** ; les quatre secrets restent configurés. Après confirmation, il déclenche le workflow GitHub officiel pour la version prévue. GitHub doit encore terminer les tests et contrôles de signature avant de publier.

Le script refuse de réécrire une clé déjà existante : s'il est relancé après une erreur réseau, il utilise **la même identité de signature**. Il refuse également un mot de passe erroné et ne lance aucune publication automatiquement. Les tests utilisent des imitations locales de `gh` et `keytool` : aucune vraie clé n'est générée durant ces tests.

## Première configuration, une seule fois

Sur Android avec Termux, installer les outils :

~~~sh
pkg install openjdk-17 coreutils
~~~

Sur PC, Java JDK 17 suffit. Générer sa propre clé, indépendante de Fieldwatch officiel :

~~~sh
keytool -genkeypair -v -keystore watch-release.jks -storetype PKCS12 -alias watch-release -keyalg RSA -keysize 3072 -validity 3650 -dname "CN=Watch Fieldwatch, OU=Watch, O=Independent, C=FR"
~~~

Le programme demande un mot de passe. Conserver la clé et le mot de passe dans une sauvegarde privée et indépendante : sans eux, il est impossible de continuer à signer les mises à jour avec la même identité.

Encoder le fichier pour GitHub Secrets :

~~~sh
base64 < watch-release.jks | tr -d '\n'
~~~

Dans https://github.com/dbrckk/Watch/settings/secrets/actions, utiliser **New repository secret** et créer :

| Nom du secret | Valeur |
|---|---|
| WATCH_KEYSTORE_BASE64 | Sortie complète de la commande base64 |
| WATCH_STORE_PASSWORD | Mot de passe du magasin |
| WATCH_KEY_ALIAS | watch-release |
| WATCH_KEY_PASSWORD | Mot de passe de la clé (PKCS12 utilise généralement le même) |

Ne pas transmettre ces valeurs dans le chat, les commits, les issues ou les captures d'écran.

## Publier la première APK stable

1. Configurer les quatre secrets avant d'exécuter le workflow.
2. Ouvrir https://github.com/dbrckk/Watch/actions/workflows/android-release.yml .
3. Choisir **Run workflow**, la branche **main** et la version **v1.1.26-watch.2**.
4. Le workflow lance les tests, compile la version release, vérifie la signature et le package, puis publie une APK et SHA256SUMS.txt.
5. Télécharger cette APK depuis https://github.com/dbrckk/Watch/releases .

La publication ne se produit pas automatiquement tant que les secrets sont absents et que le workflow n'a pas été lancé. Le fork Watch et Fieldwatch officiel peuvent cohabiter grâce à leurs identifiants Android différents.

## Pour les mises à jour

Conserver toujours la même clé. Augmenter versionCode et versionName dans app/build.gradle.kts, puis exécuter le workflow avec v suivi du nouveau versionName. Le workflow refuse les tags réutilisés.

Une ancienne APK de test (signée par une clé de debug différente) ne peut généralement pas être mise à jour en place avec la version signée. Exporter préalablement les logs et paramètres importants.

## Contrôles

Le workflow utilise Gradle testDebugUnitTest et assembleRelease, puis apksigner verify, aapt pour le package et sha256sum pour l'intégrité. Une validation sur un téléphone Android reste nécessaire pour les autorisations Wi-Fi/BLE et le partage vers Watch web.

## Protection des mises à jour signées

Avant toute publication, le workflow exécute `scripts/verify-android-release.sh` pour vérifier la signature cryptographique de l'APK, son identifiant `app.watch.fieldwatch`, et l'égalité de son `versionName` avec le tag. À partir de la deuxième release, le workflow télécharge l'APK précédente et refuse toute signature différente ou un `versionCode` inférieur ou égal. Une panne GitHub ou l'absence d'APK précédente est traitée comme un échec, pas comme une première publication. Les notes de chaque release affichent uniquement l'empreinte publique SHA-256 du certificat et le `versionCode`, jamais la clé privée. Des tests simulés de ces cas sont exécutés dans `Web checks`.

## Test réel de signature en CI, sans clé de production

Le workflow `Android CI` ne se contente plus de compiler une variante release non signée. Après les tests unitaires et l'APK debug, il génère dans l'espace temporaire du runner **une clé de test PKCS#12 jetable** (mot de passe aléatoire), compile réellement `assembleRelease` avec cette clé, puis vérifie :

- la signature Android v2 et le certificat de l'APK avec `apksigner` ;
- l'égalité de l'empreinte SHA-256 de l'APK avec celle de la clé de test ;
- l'identifiant `app.watch.fieldwatch`, le `versionCode` et le `versionName` avec `aapt`.

Cette clé n'est jamais committée, mise dans GitHub Secrets ou distribuée. Le dossier temporaire est effacé en fin de contrôle, et seule l'APK **debug** continue à être fournie comme artefact de test. Cette vérification prouve que le code et la configuration Gradle savent **produire** une APK release signée, mais elle ne crée pas la clé privée de publication permanente et ne remplace pas la validation du vrai workflow `Signed Watch Android release`.
