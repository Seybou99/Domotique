import ExpoModulesCore
import ThingSmartHomeKit
import NetworkExtension
import CoreLocation

/**
 Appairage Wi-Fi Tuya (iOS).

 Le SDK s'initialise dans `AppDelegate` via le plugin de configuration : il doit
 l'être avant toute autre API Tuya, et le faire depuis JavaScript arriverait
 trop tard sur certains chemins de démarrage.

 Mode **AP** plutôt que EZ : l'appareil expose son propre point d'accès et le
 téléphone lui transmet les identifiants Wi-Fi. Le mode EZ diffuse en multicast,
 ce que de plus en plus de routeurs bloquent — le taux d'échec est nettement
 plus élevé, pour un gain de deux ou trois manipulations.
 */
/**
 Relais du delegate d'appairage.

 `ThingSmartActivatorDelegate` est un protocole Objective-C : il exige un
 `NSObject`. Or un `Module` Expo n'en est pas un — d'où cet objet intermédiaire,
 qui se contente de transmettre les callbacks au module sous forme de fermeture.
 */
private final class ActivatorRelay: NSObject, ThingSmartActivatorDelegate {
  private let onResult: (ThingSmartDeviceModel?, Error?) -> Void

  init(onResult: @escaping (ThingSmartDeviceModel?, Error?) -> Void) {
    self.onResult = onResult
  }

  func activator(
    _ activator: ThingSmartActivator,
    didReceiveDevice deviceModel: ThingSmartDeviceModel?,
    error: (any Error)?
  ) {
    onResult(deviceModel, error)
  }
}

/**
 Autorisation de localisation, demandée pour une seule raison : lire le nom du
 réseau Wi-Fi.

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
  private var activator: ThingSmartActivator?
  private var relay: ActivatorRelay?
  private var currentHomeId: Int64 = 0
  private let locationGate = LocationGate()

  public func definition() -> ModuleDefinition {
    Name("TuyaPairingModule")

    Events("onDeviceFound", "onPairingError", "onPairingProgress")

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
          promise.resolve(["uid": ThingSmartUser.sharedInstance().uid ?? uid])
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

    AsyncFunction("startPairing") { (ssid: String, password: String, homeId: Int, timeoutS: Int, promise: Promise) in
      let home = Int64(homeId)
      self.currentHomeId = home

      // Le jeton d'appairage est valable quelques minutes et lie l'appareil au
      // foyer Tuya : sans lui, l'appareil rejoindrait le Wi-Fi sans être rattaché.
      ThingSmartActivator.sharedInstance()?.getTokenWithHomeId(home, success: { token in
        guard let token else {
          promise.reject("TUYA_TOKEN_FAILED", "Jeton d’appairage vide")
          return
        }
        let relay = ActivatorRelay { [weak self] deviceModel, error in
          guard let self else { return }
          if let error {
            self.sendEvent("onPairingError", ["message": error.localizedDescription])
            return
          }
          guard let deviceModel else {
            self.sendEvent("onPairingProgress", ["step": "binding"])
            return
          }
          self.sendEvent("onDeviceFound", [
            "deviceId": deviceModel.devId ?? "",
            "name": deviceModel.name ?? "",
          ])
        }
        let activator = ThingSmartActivator.sharedInstance()
        activator?.delegate = relay
        self.relay = relay
        self.activator = activator
        self.sendEvent("onPairingProgress", ["step": "connecting"])
        activator?.startConfigWiFi(.AP, ssid: ssid, password: password, token: token, timeout: TimeInterval(timeoutS))
        promise.resolve(nil)
      }, failure: { error in
        promise.reject("TUYA_TOKEN_FAILED", error?.localizedDescription ?? "Jeton d’appairage indisponible")
      })
    }

    AsyncFunction("stopPairing") { (promise: Promise) in
      // Toujours refermer : une fenêtre laissée ouverte continue de consommer la
      // radio et la batterie, et peut capter un appareil du voisin.
      ThingSmartActivator.sharedInstance()?.stopConfigWiFi()
      self.activator?.delegate = nil
      self.activator = nil
      self.relay = nil
      promise.resolve(nil)
    }
  }
}
