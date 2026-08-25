import ExpoModulesCore
import ThingSmartHomeKit
import ThingSmartBLEKit
import ThingSmartBLECoreKit
import NetworkExtension
import CoreLocation

/**
 Appairage Tuya (iOS).

 **Bluetooth d'abord, et non le mode AP.** Les appareils Tuya récents — la prise
 LSC en est une — sont bimodes : ils annoncent leur présence en Bluetooth tant
 qu'ils ne sont pas appairés, et reçoivent les identifiants Wi-Fi par ce canal.
 L'application les découvre donc *avant* toute saisie, là où le mode AP obligeait
 à taper un réseau à l'aveugle en espérant que l'appareil écoutait. C'est le
 parcours de l'application du fabricant, et c'est celui que le matériel attend.

 Le mode AP reste le seul recours pour un appareil Wi-Fi sans Bluetooth ; il n'est
 pas exposé ici tant qu'aucun appareil du foyer n'en a besoin — le garder sans
 pouvoir le tester en ferait du code mort qui pourrit.

 Le pilotage n'est toujours pas du ressort du SDK : une fois appairé, l'appareil
 est visible du projet cloud et c'est le backend qui le commande. Sans quoi un
 scénario programmé à 23:30 ne partirait pas téléphone éteint.
 */

/**
 Relais des delegates Objective-C.

 `ThingSmartBLEManagerDelegate` et `ThingSmartBLEWifiActivatorDelegate` exigent un
 `NSObject` ; un `Module` Expo n'en est pas un. Cet objet intermédiaire transmet
 chaque rappel sous forme de fermeture.
 */
private final class BLERelay: NSObject, ThingSmartBLEManagerDelegate, ThingSmartBLEWifiActivatorDelegate {
  var onDiscovered: ((ThingBLEAdvModel) -> Void)?
  var onPaired: ((ThingSmartDeviceModel?, Error?) -> Void)?
  var onWifiList: (([Any], String, Error?) -> Void)?
  var onBluetoothState: ((Bool) -> Void)?
  /// Trace destinée au terminal Metro : le SDK échoue souvent sans rien dire, et
  /// distinguer « pas de réponse » de « refus » demande de voir ses rappels.
  var onTrace: ((String) -> Void)?

  /**
   L'appareil n'est plus en mode configuration réseau.

   Rappel optionnel du protocole, et la seule façon d'apprendre que l'appareil a
   quitté sa fenêtre d'association — sans lui, l'appairage semble se perdre.
   */
  func bleWifiActivator(_ activator: ThingSmartBLEWifiActivator, notConfigStateWithError error: Error) {
    onTrace?("notConfigState : \(error.localizedDescription)")
  }

  func didDiscoveryDevice(withDeviceInfo deviceInfo: ThingBLEAdvModel) {
    onDiscovered?(deviceInfo)
  }

  func bluetoothDidUpdateState(_ isPoweredOn: Bool) {
    onBluetoothState?(isPoweredOn)
  }

  func bleWifiActivator(
    _ activator: ThingSmartBLEWifiActivator,
    didReceiveBLEWifiConfigDevice deviceModel: ThingSmartDeviceModel?,
    error: Error?
  ) {
    onTrace?(
      "didReceiveBLEWifiConfigDevice : device=\(deviceModel?.devId ?? "nil") error=\(error?.localizedDescription ?? "nil")"
    )
    onPaired?(deviceModel, error)
  }

  // `error` n'est pas optionnel dans le protocole Objective-C, contrairement à ce
  // que suggère son usage : le SDK passe une erreur vide plutôt que `nil`.
  func bleWifiActivator(
    _ activator: ThingSmartBLEWifiActivator,
    didScanWifiList wifiList: [Any],
    uuid: String,
    error: Error
  ) {
    onWifiList?(wifiList, uuid, error)
  }
}

/**
 Autorisation de localisation, demandée pour une seule raison : lire le nom du
 réseau Wi-Fi courant.

 iOS ne rend le SSID lisible qu'à trois conditions réunies — l'entitlement
 *Access WiFi Information*, l'autorisation de localisation accordée, et le
 service actif. Aucune position n'est relevée : le gestionnaire ne démarre jamais
 de mise à jour, il sert uniquement de porte d'entrée.
 */
private final class LocationGate: NSObject, CLLocationManagerDelegate {
  /**
   Créé au premier appel, et non à l'initialisation.

   Un `CLLocationManager` construit sur un thread dépourvu de boucle d'exécution
   ne délivre jamais ses rappels de delegate : l'invite d'autorisation ne
   s'affiche pas et la promesse reste ouverte, sans la moindre erreur. Or Expo
   n'instancie pas forcément ses modules sur le thread principal. `lazy` diffère
   la création jusqu'à `authorize`, appelé lui sur le thread principal.
   */
  private lazy var manager: CLLocationManager = {
    let created = CLLocationManager()
    created.delegate = self
    return created
  }()

  private var pending: ((Bool) -> Void)?

  private static func granted(_ status: CLAuthorizationStatus) -> Bool {
    status == .authorizedWhenInUse || status == .authorizedAlways
  }

  func authorize(_ completion: @escaping (Bool) -> Void) {
    let status = manager.authorizationStatus
    if Self.granted(status) {
      completion(true)
      return
    }
    // Un refus déjà exprimé ne se redemande pas : iOS ne réafficherait aucune
    // invite, et l'appel resterait sans réponse.
    if status != .notDetermined {
      completion(false)
      return
    }
    pending = completion
    manager.requestWhenInUseAuthorization()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    guard status != .notDetermined, let completion = pending else { return }
    pending = nil
    completion(Self.granted(status))
  }
}

public class TuyaPairingModule: Module {
  private var currentHomeId: Int64 = 0
  private let locationGate = LocationGate()
  private let relay = BLERelay()

  /**
   Un seul activateur, pour toute la durée de l'écran.

   `connectAndQueryWifiList` ouvre une connexion Bluetooth avec l'appareil et la
   conserve sur l'objet. En créer un second pour lancer l'appairage jetait cette
   session : la configuration partait sans elle, le rappel de succès ne signifiait
   plus rien, et le résultat n'arrivait jamais — le SDK répondait à un objet
   déjà libéré.
   */
  private lazy var activator: ThingSmartBLEWifiActivator = {
    let created = ThingSmartBLEWifiActivator()
    created.bleWifiDelegate = self.relay
    return created
  }()
  /// Les appareils déjà signalés, pour ne pas republier la même annonce en boucle :
  /// une balise Bluetooth émet plusieurs fois par seconde.
  private var seen: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("TuyaPairingModule")

    Events("onDeviceDiscovered", "onDeviceFound", "onPairingError", "onPairingProgress", "onTrace")

    /**
     Initialisation du SDK, au plus tôt.

     Ici plutôt que dans `AppDelegate` : seul ce module dépend des pods Tuya, la
     cible de l'application ne les voit pas. Et comme tous les appels Tuya
     passent par ce module, `OnCreate` précède forcément le premier d'entre eux.

     Les clés viennent de l'`Info.plist`, où le plugin de configuration les a
     écrites — une seule source, pas de valeur recopiée.
     */
    OnCreate {
      guard
        let key = Bundle.main.object(forInfoDictionaryKey: "TuyaAppKey") as? String,
        let secret = Bundle.main.object(forInfoDictionaryKey: "TuyaAppSecret") as? String,
        !key.isEmpty, !secret.isEmpty
      else {
        NSLog("[TuyaPairing] Clés absentes de l’Info.plist — SDK non initialisé.")
        return
      }
      ThingSmartSDK.sharedInstance().start(withAppKey: key, secretKey: secret)

      // Les journaux internes du SDK, en développement seulement : lui seul sait
      // dire pourquoi une association n'aboutit pas, et il ne le rapporte par
      // aucun rappel. Visibles dans la console Xcode.
      #if DEBUG
        ThingSmartSDK.sharedInstance().debugMode = true
      #endif

      self.relay.onTrace = { [weak self] message in
        NSLog("[TuyaPairing] \(message)")
        self?.sendEvent("onTrace", ["message": message])
      }

      self.relay.onDiscovered = { [weak self] device in
        guard let self, let uuid = device.uuid, !self.seen.contains(uuid) else { return }
        self.seen.insert(uuid)
        self.sendEvent("onDeviceDiscovered", [
          "uuid": uuid,
          "productId": device.productId ?? "",
          "mac": device.mac ?? "",
          // Un appareil qui ne capte pas le 5 GHz : l'écran peut prévenir avant
          // que l'utilisateur ne choisisse un réseau que l'appareil ignorera.
          "supports5G": device.isSupport5G,
        ])
      }
    }

    /**
     Nom du réseau Wi-Fi courant, pour préremplir la saisie.

     Renvoie `nil` sans jamais échouer : l'autorisation peut être refusée,
     l'entitlement absent du profil de signature, ou le téléphone en 4G. Aucun de
     ces cas n'est une erreur — l'écran retombe sur la saisie manuelle, et une
     promesse rejetée l'obligerait à traiter en échec ce qui n'en est pas un.
     */
    AsyncFunction("currentSsid") { (promise: Promise) in
      DispatchQueue.main.async {
        self.locationGate.authorize { granted in
          guard granted else {
            promise.resolve(nil)
            return
          }
          NEHotspotNetwork.fetchCurrent { network in
            promise.resolve(network?.ssid)
          }
        }
      }
    }

    AsyncFunction("signIn") { (countryCode: String, uid: String, password: String, promise: Promise) in
      // `loginOrRegister` : le compte Tuya est technique, créé au premier appel
      // et réutilisé ensuite. L'identifiant vient du backend, pas de l'appareil,
      // pour qu'une réinstallation retrouve le même compte et ses appareils.
      ThingSmartUser.sharedInstance().loginOrRegister(
        withCountryCode: countryCode,
        uid: uid,
        password: password,
        createHome: false,
        success: { _ in
          self.relay.onTrace?("signIn : ok — uid=\(ThingSmartUser.sharedInstance().uid)")
          promise.resolve(["uid": ThingSmartUser.sharedInstance().uid])
        },
        failure: { error in
          promise.reject("TUYA_SIGNIN_FAILED", error?.localizedDescription ?? "Connexion Tuya impossible")
        }
      )
    }

    AsyncFunction("ensureHome") { (name: String, promise: Promise) in
      ThingSmartHomeManager().getHomeList(success: { homes in
        if let existing = homes?.first {
          self.currentHomeId = existing.homeId
          self.relay.onTrace?("ensureHome : foyer existant homeId=\(existing.homeId)")
          promise.resolve(["homeId": existing.homeId])
          return
        }
        // Aucun foyer Tuya : on en crée un. Il ne sert qu'à satisfaire le SDK —
        // la vraie notion de foyer vit dans notre backend.
        ThingSmartHomeManager().addHome(
          withName: name,
          geoName: "",
          rooms: [],
          latitude: 0,
          longitude: 0,
          success: { homeId in
            self.currentHomeId = homeId
            promise.resolve(["homeId": homeId])
          },
          failure: { error in
            promise.reject("TUYA_HOME_FAILED", error?.localizedDescription ?? "Foyer Tuya indisponible")
          }
        )
      }, failure: { error in
        promise.reject("TUYA_HOME_FAILED", error?.localizedDescription ?? "Foyers Tuya illisibles")
      })
    }

    /**
     Écoute des appareils non appairés à proximité.

     Chaque découverte part en événement plutôt que dans la réponse : les
     appareils arrivent un par un, au fil des annonces Bluetooth, et attendre une
     liste complète ferait patienter devant un écran vide alors que le premier
     appareil est déjà là.
     */
    AsyncFunction("startScan") { (promise: Promise) in
      DispatchQueue.main.async {
        self.seen.removeAll()
        let manager = ThingSmartBLEManager.sharedInstance()
        manager.delegate = self.relay
        guard manager.isPoweredOn else {
          promise.reject("BLE_OFF", "Le Bluetooth est désactivé sur cet appareil.")
          return
        }
        // `true` : on vide le cache du SDK, sinon un appareil appairé puis
        // réinitialisé ne réapparaîtrait pas.
        manager.startListening(true)
        promise.resolve(nil)
      }
    }

    AsyncFunction("stopScan") { (promise: Promise) in
      DispatchQueue.main.async {
        ThingSmartBLEManager.sharedInstance().stopListening(true)
        self.seen.removeAll()
        promise.resolve(nil)
      }
    }

    /**
     Réseaux Wi-Fi que l'appareil capte, à lui demander par Bluetooth.

     C'est l'appareil qui répond, et non le téléphone : la liste ne contient donc
     que des réseaux qu'il peut réellement rejoindre. Tous les modèles ne le
     savent pas faire — l'écran doit prévoir la saisie manuelle en repli.
     */
    AsyncFunction("queryWifiList") { (uuid: String, promise: Promise) in
      DispatchQueue.main.async {
        self.relay.onWifiList = { list, _, error in
          if let error {
            promise.reject("TUYA_WIFI_LIST_FAILED", error.localizedDescription)
            return
          }
          // Le SDK renvoie des dictionnaires : on ne garde que le nom, seul
          // élément dont l'écran a besoin.
          let names = list.compactMap { entry -> String? in
            (entry as? [String: Any])?["ssid"] as? String
          }
          promise.resolve(names)
        }

        // Le succès signale seulement que la demande est partie ; la liste, elle,
        // arrive par le delegate.
        self.activator.connectAndQueryWifiList(withUUID: uuid, success: {}) { error in
          promise.reject("TUYA_WIFI_LIST_FAILED", error?.localizedDescription ?? "Liste des réseaux indisponible")
        }
      }
    }

    /**
     Appairage proprement dit : les identifiants Wi-Fi partent par Bluetooth.

     Le jeton n'est pas demandé ici — `startConfigBLEWifiDevice` s'en charge à
     partir du foyer, contrairement au mode AP où il fallait le réclamer d'abord.
     */
    AsyncFunction("pairDevice") { (uuid: String, productId: String, ssid: String, password: String, homeId: Int, timeoutS: Int, promise: Promise) in
      DispatchQueue.main.async {
        let home = Int64(homeId)
        self.currentHomeId = home

        self.relay.onPaired = { [weak self] deviceModel, error in
          guard let self else { return }
          if let error {
            self.sendEvent("onPairingError", ["message": error.localizedDescription])
            return
          }
          // Ni appareil ni erreur : le SDK rend la main sans rien conclure. Le
          // taire laissait l'écran tourner jusqu'au délai maximal, sans que rien
          // n'explique l'attente.
          guard let deviceModel else {
            self.sendEvent("onPairingError", [
              "message": "Le service du fabricant a répondu sans identifier l’appareil.",
            ])
            return
          }
          self.sendEvent("onDeviceFound", [
            "deviceId": deviceModel.devId ?? "",
            "name": deviceModel.name ?? "",
          ])
        }

        self.sendEvent("onPairingProgress", ["step": "connecting"])
        self.activator.startConfigBLEWifiDevice(
          withUUID: uuid,
          homeId: home,
          productId: productId,
          ssid: ssid,
          password: password,
          timeout: TimeInterval(timeoutS),
          success: {
            self.relay.onTrace?("startConfigBLEWifiDevice : success")
            self.sendEvent("onPairingProgress", ["step": "binding"])
          },
          // Ce rappel-ci ne porte aucune erreur — le SDK ne la transmet qu'au
          // delegate. D'où un message générique ici, et le détail via
          // `didReceiveBLEWifiConfigDevice` lorsqu'il en donne un.
          failure: {
            self.sendEvent("onPairingError", [
              "message": "L’appareil n’a pas pu rejoindre le réseau.",
            ])
          }
        )
        promise.resolve(nil)
      }
    }

    /**
     Appareils actuellement rattachés au foyer Tuya.

     **Le filet de sécurité du rappel d'appairage.** Une fois la configuration
     reçue, l'appareil bascule sur le Wi-Fi et cesse d'accepter les connexions
     Bluetooth ; le SDK, lui, tente de s'y reconnecter, échoue, et conclut à un
     échec sans jamais appeler son delegate — alors même que le journal montre
     l'appareil créé côté serveur. Interroger le foyer contourne ce rappel
     manquant : ce que le serveur dit fait foi, pas ce que le Bluetooth croit.

     L'écran compare cette liste à celle d'avant l'appairage ; le nouveau venu est
     l'appareil qu'on vient d'ajouter.
     */
    AsyncFunction("homeDevices") { (homeId: Int, promise: Promise) in
      let home = ThingSmartHome(homeId: Int64(homeId))
      home?.getDataWithSuccess({ _ in
        let devices = (home?.deviceList ?? []).map { device in
          [
            "deviceId": device.devId ?? "",
            "name": device.name ?? "",
            // Date d'activation, en secondes : c'est elle qui distingue
            // l'appareil qu'on vient d'appairer de ceux déjà présents. Comparer
            // les listes ne suffit pas — un appareil réappairé était déjà là.
            "activeTime": device.activeTime,
          ] as [String: Any]
        }
        self.relay.onTrace?("homeDevices : \(devices.count) appareil(s)")
        promise.resolve(devices)
      }, failure: { error in
        promise.reject("TUYA_HOME_DEVICES_FAILED", error?.localizedDescription ?? "Foyer illisible")
      })
    }

    AsyncFunction("stopPairing") { (promise: Promise) in
      // Toujours refermer : une écoute laissée ouverte continue de consommer la
      // radio et la batterie, et peut capter un appareil du voisin.
      DispatchQueue.main.async {
        ThingSmartBLEManager.sharedInstance().stopListening(true)
        self.relay.onPaired = nil
        self.relay.onWifiList = nil
        // L'activateur, lui, survit à l'arrêt : sa connexion Bluetooth est
        // réutilisée d'une tentative à l'autre, et le recréer est précisément ce
        // qui faisait perdre le résultat.
        self.seen.removeAll()
        promise.resolve(nil)
      }
    }
  }
}
