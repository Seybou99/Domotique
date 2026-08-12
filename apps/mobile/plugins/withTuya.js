const fs = require('node:fs');
const path = require('node:path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  createRunOncePlugin,
} = require('expo/config-plugins');

/**
 * Configuration native du SDK Tuya.
 *
 * `expo prebuild` régénère `ios/` et `android/` et écrase toute modification
 * manuelle. Tout ce qui doit survivre passe donc par ce plugin — c'est la seule
 * façon de garder une configuration native reproductible dans un projet Expo.
 *
 * Il fait quatre choses :
 *  1. injecte les clés d'application dans le `Info.plist` et le manifeste ;
 *  2. déclare les dépôts Maven et l'archive de sécurité côté Android ;
 *  3. ajoute les sources de podspecs Tuya et le pod de chiffrement côté iOS ;
 *  4. déclare les permissions réseau exigées par l'appairage en mode AP.
 *
 * L'initialisation du SDK, elle, vit dans le module natif : seule sa cible
 * dépend des pods Tuya, et `OnCreate` s'exécute avant tout appel.
 */

function readKeys(projectRoot) {
  const file = path.join(projectRoot, 'secrets', 'tuya.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      'secrets/tuya.json est absent. Copiez secrets/tuya.example.json et renseignez vos clés SDK.',
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ───────────────────────────────────────────────────────────────────── iOS

const withTuyaInfoPlist = (config, keys) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.TuyaAppKey = keys.ios.appKey;
    cfg.modResults.TuyaAppSecret = keys.ios.appSecret;

    /**
     * L'appairage en mode AP fait rejoindre au téléphone le point d'accès de
     * l'appareil, puis lui parle en direct. iOS exige une justification pour
     * l'accès au réseau local, et refuse la connexion sans elle.
     */
    cfg.modResults.NSLocalNetworkUsageDescription =
      'Nécessaire pour configurer vos appareils connectés sur votre réseau Wi-Fi.';
    cfg.modResults.NSBonjourServices = ['_tuya._tcp', '_http._tcp'];
    cfg.modResults.NSLocationWhenInUseUsageDescription =
      'iOS demande cette autorisation pour lire le nom du réseau Wi-Fi auquel vous êtes connecté.';
    return cfg;
  });

/**
 * Lecture du nom du réseau Wi-Fi courant.
 *
 * Sans cet entitlement, `NEHotspotNetwork.fetchCurrent` renvoie toujours `nil` :
 * le champ reste à saisir à la main, ce que l'écran gère, mais le préremplissage
 * ne fonctionne pas.
 *
 * **Il exige un compte développeur payant**, avec la capacité *Access WiFi
 * Information* activée sur l'identifiant d'application. Un profil de signature
 * qui ne la porte pas fait échouer la signature — retirer cette ligne suffit
 * alors à rebâtir, au prix du préremplissage.
 */
const withWifiInfo = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.networking.wifi-info'] = true;
    return cfg;
  });

/**
 * Ajout des sources de podspecs Tuya et du pod de chiffrement.
 *
 * `ThingSmartCryption` n'est pas publié : c'est une archive chiffrée, liée à
 * l'identifiant de bundle, que l'on télécharge depuis la console. Elle est donc
 * référencée par chemin local.
 */
const withTuyaPodfile = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');

      const sources = [
        "source 'https://github.com/CocoaPods/Specs.git'",
        "source 'https://github.com/TuyaInc/TuyaPublicSpecs.git'",
        "source 'https://github.com/tuya/tuya-pod-specs.git'",
      ];
      for (const source of sources) {
        if (!contents.includes(source)) contents = `${source}\n${contents}`;
      }

      const cryptionPath = path.join(cfg.modRequest.projectRoot, 'secrets', 'ios_core_sdk');
      if (fs.existsSync(cryptionPath) && !contents.includes('ThingSmartCryption')) {
        // Injecté dans la target de l'app, après `use_expo_modules!`.
        contents = contents.replace(
          /(use_expo_modules!\s*\n)/,
          `$1  pod 'ThingSmartCryption', :path => '../secrets/ios_core_sdk'\n`,
        );
      }

      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);

// ─────────────────────────────────────────────────────────────────── Android

const withTuyaManifest = (config, keys) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;

    application['meta-data'] = (application['meta-data'] ?? []).filter(
      (entry) => !String(entry.$['android:name']).startsWith('TUYA_SMART_APP'),
    );
    application['meta-data'].push(
      { $: { 'android:name': 'TUYA_SMART_APPKEY', 'android:value': keys.android.appKey } },
      { $: { 'android:name': 'TUYA_SMART_SECRET', 'android:value': keys.android.appSecret } },
    );

    // L'appairage en mode AP bascule le téléphone sur le point d'accès de
    // l'appareil : Android exige ces permissions pour l'énumérer et s'y joindre.
    const permissions = [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_STATE',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
      'android.permission.NEARBY_WIFI_DEVICES',
    ];
    cfg.modResults.manifest['uses-permission'] = cfg.modResults.manifest['uses-permission'] ?? [];
    for (const name of permissions) {
      const already = cfg.modResults.manifest['uses-permission'].some(
        (entry) => entry.$['android:name'] === name,
      );
      if (!already) {
        cfg.modResults.manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    return cfg;
  });

const withTuyaRepositories = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('maven-other.tuya.com')) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      `allprojects {
    repositories {
        maven { url 'https://maven-other.tuya.com/repository/maven-releases/' }
        maven { url 'https://maven-other.tuya.com/repository/maven-commercial-releases/' }`,
    );
    return cfg;
  });

/**
 * L'archive de sécurité Android est un `.aar` local : on la copie dans
 * `android/app/libs` à chaque prebuild et on déclare le dépôt `flatDir`.
 */
const withTuyaSecurityArchive = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const source = findSecurityArchive(cfg.modRequest.projectRoot);
      if (!source) return cfg;

      const libs = path.join(cfg.modRequest.platformProjectRoot, 'app', 'libs');
      fs.mkdirSync(libs, { recursive: true });
      fs.copyFileSync(source, path.join(libs, path.basename(source)));
      return cfg;
    },
  ]);

const withTuyaAppGradle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes("dirs 'libs'")) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /android\s*\{/,
      `android {
    repositories {
        flatDir { dirs 'libs' }
    }`,
    );
    return cfg;
  });

/** L'archive vit dans `secrets/`, ou dans le paquet SDK décompressé à la racine. */
function findSecurityArchive(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'secrets'),
    path.join(projectRoot, '..', '..', 'Android_SDK'),
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const found = fs.readdirSync(dir).find((f) => f.startsWith('security-algorithm') && f.endsWith('.aar'));
    if (found) return path.join(dir, found);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────

const withTuya = (config) => {
  const keys = readKeys(config._internal?.projectRoot ?? process.cwd());

  let result = withTuyaInfoPlist(config, keys);
  // `withWifiInfo` volontairement désactivé : la capacité qu'il déclare n'existe
  // que sur un compte développeur payant, et un profil qui ne la porte pas fait
  // échouer la signature. Voir le commentaire de la fonction pour la réactiver.
  result = withTuyaPodfile(result);
  result = withTuyaManifest(result, keys);
  result = withTuyaRepositories(result);
  result = withTuyaAppGradle(result);
  result = withTuyaSecurityArchive(result);
  return result;
};

module.exports = createRunOncePlugin(withTuya, 'withTuya', '1.0.0');
