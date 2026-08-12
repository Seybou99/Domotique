package com.lumo.tuya

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import androidx.core.content.ContextCompat
import com.thingclips.smart.android.user.api.ILoginCallback
import com.thingclips.smart.android.user.bean.User
import com.thingclips.smart.home.sdk.ThingHomeSdk
import com.thingclips.smart.home.sdk.bean.HomeBean
import com.thingclips.smart.home.sdk.callback.IThingGetHomeListCallback
import com.thingclips.smart.home.sdk.callback.IThingHomeResultCallback
import com.thingclips.smart.sdk.api.IResultCallback
import com.thingclips.smart.sdk.bean.DeviceBean
import com.thingclips.smart.home.sdk.builder.ActivatorBuilder
import com.thingclips.smart.sdk.api.IThingActivator
import com.thingclips.smart.sdk.api.IThingSmartActivatorListener
import com.thingclips.smart.sdk.enums.ActivatorModelEnum
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Appairage Wi-Fi Tuya (Android).
 *
 * Même périmètre que la version iOS : appairage seulement. Le pilotage reste au
 * backend, sans quoi les scénarios ne partiraient pas téléphone éteint.
 *
 * Le SDK est initialisé dans l'`Application` générée par le plugin de
 * configuration ; les clés viennent du `AndroidManifest`.
 */
class TuyaPairingModule : Module() {
  private var activator: IThingActivator? = null
  private var homeId: Long = 0

  override fun definition() = ModuleDefinition {
    Name("TuyaPairingModule")

    Events("onDeviceFound", "onPairingError", "onPairingProgress")

    /**
     * Nom du réseau Wi-Fi courant, pour préremplir la saisie.
     *
     * Renvoie `null` sans jamais échouer : Android ne livre le SSID qu'avec la
     * localisation accordée, et l'appareil peut être en données mobiles. Aucun de
     * ces cas n'est une erreur — l'écran retombe sur la saisie manuelle.
     *
     * La permission n'est pas demandée ici : elle l'est de toute façon pour
     * l'appairage lui-même, et une invite surgissant au simple affichage d'un
     * champ de saisie serait incompréhensible.
     */
    AsyncFunction("currentSsid") { promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }

      val allowed = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION,
      ) == PackageManager.PERMISSION_GRANTED
      if (!allowed) {
        promise.resolve(null)
        return@AsyncFunction
      }

      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      val raw = wifi.connectionInfo?.ssid
      // Android entoure le SSID de guillemets, et renvoie ce littéral quand il
      // refuse de le donner malgré la permission.
      val ssid = raw?.trim('"')?.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
      promise.resolve(ssid)
    }

    AsyncFunction("signIn") { countryCode: String, uid: String, password: String, promise: expo.modules.kotlin.Promise ->
      ThingHomeSdk.getUserInstance().loginOrRegisterWithUid(
        countryCode, uid, password, false,
        object : ILoginCallback {
          override fun onSuccess(user: User) = promise.resolve(mapOf("uid" to user.uid))
          override fun onError(code: String, error: String) =
            promise.reject("TUYA_SIGNIN_FAILED", error, null)
        },
      )
    }

    AsyncFunction("ensureHome") { name: String, promise: expo.modules.kotlin.Promise ->
      ThingHomeSdk.getHomeManagerInstance().queryHomeList(object : IThingGetHomeListCallback {
        override fun onSuccess(homeBeans: MutableList<HomeBean>?) {
          val existing = homeBeans?.firstOrNull()
          if (existing != null) {
            homeId = existing.homeId
            promise.resolve(mapOf("homeId" to existing.homeId))
            return
          }
          // Foyer technique : la vraie notion de foyer vit dans notre backend.
          ThingHomeSdk.getHomeManagerInstance().createHome(
            name, 0.0, 0.0, "", emptyList(),
            object : IThingHomeResultCallback {
              override fun onSuccess(bean: HomeBean) {
                homeId = bean.homeId
                promise.resolve(mapOf("homeId" to bean.homeId))
              }
              override fun onError(code: String, error: String) =
                promise.reject("TUYA_HOME_FAILED", error, null)
            },
          )
        }
        override fun onError(code: String, error: String) =
          promise.reject("TUYA_HOME_FAILED", error, null)
      })
    }

    AsyncFunction("startPairing") { ssid: String, password: String, home: Int, timeoutS: Int, promise: expo.modules.kotlin.Promise ->
      homeId = home.toLong()
      // Le jeton lie l'appareil au foyer : sans lui, il rejoindrait le Wi-Fi
      // sans être rattaché à quoi que ce soit.
      ThingHomeSdk.getActivatorInstance().getActivatorToken(
        homeId,
        object : com.thingclips.smart.sdk.api.IThingActivatorGetToken {
          override fun onSuccess(token: String) {
            sendEvent("onPairingProgress", mapOf("step" to "connecting"))
            val builder = ActivatorBuilder()
              .setSsid(ssid)
              .setPassword(password)
              .setActivatorModel(ActivatorModelEnum.THING_AP)
              .setTimeOut(timeoutS.toLong())
              .setContext(appContext.reactContext)
              .setToken(token)
              .setListener(object : IThingSmartActivatorListener {
                override fun onError(code: String, msg: String) =
                  sendEvent("onPairingError", mapOf("message" to msg))
                override fun onActiveSuccess(devResp: DeviceBean) =
                  sendEvent("onDeviceFound", mapOf("deviceId" to devResp.devId, "name" to devResp.name))
                override fun onStep(step: String, data: Any?) =
                  sendEvent("onPairingProgress", mapOf("step" to "binding"))
              })

            activator = ThingHomeSdk.getActivatorInstance().newMultiActivator(builder)
            activator?.start()
            promise.resolve(null)
          }

          override fun onFailure(code: String, error: String) =
            promise.reject("TUYA_TOKEN_FAILED", error, null)
        },
      )
    }

    AsyncFunction("stopPairing") { promise: expo.modules.kotlin.Promise ->
      // Une fenêtre laissée ouverte consomme la radio et peut capter l'appareil
      // d'un voisin : on referme systématiquement.
      activator?.stop()
      activator?.onDestroy()
      activator = null
      promise.resolve(null)
    }
  }
}
