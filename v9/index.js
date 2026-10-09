(function () {
  const { before, after } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { React, ReactNative, clipboard } = vendetta.metro.common;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { findInReactTree } = vendetta.utils;
  const { Forms } = vendetta.ui.components;

  const ActionSheet = findByProps("openLazy", "hideActionSheet");
  const LABEL = "画像をコピー (v9)";
  const KEY = "copy-image-v9";
  const unpatches = [];
  let buf = [];
  const dbg = (m) => {
    console.log("[CopyImage] " + m);
    buf.push(m);
  };
  const flush = () => {
    buf = [];
  };

  function toBase64(url) {
    return fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(blob);
          })
      );
  }

  async function copyImage(url) {
    try { showToast("CopyImage v7: 開始"); } catch {}
    try { ActionSheet.hideActionSheet(); } catch (e) { console.log("[CopyImage] hide失敗", e); }
    try {
      if (typeof clipboard.setImage !== "function")
        throw new Error("このクライアントは画像コピー非対応");
      const b64 = await toBase64(url);
      const ret = await clipboard.setImage(b64);
      showToast("画像をコピーしました", getAssetIDByName("ic_message_copy"));
      // 診断v9: ネイティブモジュールの実体を直接引いて、メソッド名を列挙する
      const names = ["NativeAdsModule","NativeAppAttestModule","NativeAppDatabaseModule","NativeAppIconModule","NativeAppLifecycleModule","NativeAppRatingRequestModule","NativeAppStoreModule","NativeAudioManagerModule","NativeAudioPlayerModule","NativeAudioRouteEmitterModule","NativeAuthenticationModule","NativeBrowserManagerModule","NativeCacheModule","NativeChatModule","NativeClientInfoModule","NativeCommandClipboardModule","NativeCompressionModule","NativeDateFormatUtilsModule","NativeDeviceAccessibilityModule","NativeDeviceLocaleModule","NativeDeviceModule","NativeDeviceSettingsModule","NativeDeviceThermalStateModule","NativeDigitalCredentialModule","NativeDiskUsageModule","NativeFastConnectModule","NativeFileModule","NativeFontModule","NativeI18nModule","NativeImageManagerModule","NativeInstallTimeModule","NativeIntentsModule","NativeJSWatchdogModule","NativeJankSessionModule","NativeJankStatsModule","NativeKeyCommandsModule","NativeKeyboardModule","NativeLinkingModule","NativeMediaEngineModule","NativeMediaManagerModule","NativeMetaQuestModule","NativeMetricMonitorModule","NativeMobileVoiceOverlayModule","NativeNotifSettingsModule","NativeOnDemandResourceModule","NativePermissionManagerModule","NativePlayAgeSignalsModule","NativePlayIntegrityModule","NativePortalFromNativeModule","NativeProximitySensorManagerModule","NativePushNotificationMonitorModule","NativeReactAssetModule","NativeRemoteAuthCryptoModule","NativeSafeAreaInsetsModule","NativeScreenWakeLockModule","NativeSecurityKeyManagerModule","NativeShareManagerModule","NativeSystraceModule","NativeTTIManagerModule","NativeTTIModule","NativeTelecomModule","NativeTelemetryRingModule","NativeThemeModule","NativeTimezoneHermesFixModule","NativeTouchEventAnalyticsModule","DCDClipboardManager","DCDFileManager","DCDChat","DCDDevice","DCDSettings","RNCClipboard","RNCClipboardModule","ClipboardModule","BunnyNative","VendettaNative","KettuNative","RTNFileManager","RTNLoader","NativeClipboard","ImageManager","ShareManager"];
      const NMp = globalThis.nativeModuleProxy ?? ReactNative.NativeModules ?? {};
      const fnsOf = (m) => {
        const set = new Set();
        try { for (const k in m) set.add(k); } catch {}
        try { Object.getOwnPropertyNames(m).forEach((k) => set.add(k)); } catch {}
        try { const p = Object.getPrototypeOf(m); if (p) Object.getOwnPropertyNames(p).forEach((k) => set.add(k)); } catch {}
        return [...set].filter((k) => k !== "constructor");
      };
      const rep = [];
      for (const n of names) {
        let m;
        try { m = NMp[n]; } catch {}
        if (!m) try { m = globalThis.__turboModuleProxy?.(n); } catch {}
        if (!m) continue;
        rep.push(n + ": " + fnsOf(m).join(","));
      }
      rep.unshift("見つかったモジュール数=" + rep.length);
      clipboard.setString("CopyImage v9診断\n" + rep.join("\n"));
      showToast("v9: 診断をクリップボードにコピーしました。チャットに貼り付けてください");
    } catch (e) {
      let msg = String(e?.message ?? e);
      try {
        const NM = ReactNative.NativeModules;
        const mods = Object.keys(NM).filter((k) => /clip|share|image|file|media/i.test(k));
        msg +=
          "\n\n[native]\n" +
          mods
            .map((k) => k + ": " + Object.keys(NM[k] ?? {}).filter((m) => typeof NM[k][m] === "function").join(","))
            .join("\n");
      } catch {}
      clipboard.setString(url);
      setTimeout(() => {
        try {
          ReactNative.Alert.alert(
            "画像をコピーできませんでした",
            msg + "\n\n代わりに画像のリンクをコピーしました。"
          );
        } catch {
          showToast("コピー失敗: " + msg, getAssetIDByName("Small"));
        }
      }, 400);
    }
  }

  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)(\?|$)/i;
  const urlOf = (o) => o?.url ?? o?.proxy_url ?? o?.proxyURL ?? o?.proxyUrl;

  function findImageUrl(message) {
    const att = message.attachments?.find((a) => {
      const type = a.content_type ?? a.contentType;
      return (
        type?.startsWith?.("image/") ||
        (a.width && a.height) ||
        IMG_EXT.test(a.filename ?? urlOf(a) ?? "")
      );
    });
    return (
      urlOf(att) ??
      urlOf(message.embeds?.find((e) => urlOf(e.image))?.image) ??
      urlOf(message.embeds?.find((e) => urlOf(e.thumbnail))?.thumbnail)
    );
  }

  function dumpTree(root) {
    const out = [];
    const seen = new Set();
    const name = (t) =>
      typeof t === "string" ? t : t?.displayName ?? t?.name ?? t?.type?.name ?? t?.render?.name ?? typeof t;
    (function walk(n, d, p) {
      if (out.length >= 45 || d > 9 || n == null || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) {
        out.push(" ".repeat(d) + p + "[" + n.length + "]");
        n.forEach((c, i) => walk(c, d + 1, i + ":"));
        return;
      }
      if (n.props || n.type) {
        const pr = n.props ?? {};
        const lab = pr.label ?? pr.message ?? pr.title ?? "";
        out.push(" ".repeat(d) + p + name(n.type) + (lab && typeof lab === "string" ? " '" + lab + "'" : ""));
        if (pr.children) walk(pr.children, d + 1, "c:");
      }
    })(root, 0, "");
    return out.join("\n");
  }

  function inject(sheet, url) {
    const iconId =
      getAssetIDByName("ic_message_copy") ?? getAssetIDByName("CopyIcon") ?? getAssetIDByName("copy");
    const onPress = () => copyImage(url);

    // 新レイアウト: ActionSheetRowGroup の中に ActionSheetRow が並ぶ
    // 型名は最小化されるので使わず、「コピー」系ラベルの行を含む配列を探す
    const rowLabel = (c) => String(c?.props?.label ?? c?.props?.message ?? "");
    const children = findInReactTree(
      sheet,
      (x) =>
        Array.isArray(x) &&
        x.some((c) => c?.type && c?.props?.icon) &&
        x.some((c) => /コピー|copy/i.test(rowLabel(c)))
    );
    dbg(
      "rows=" + (Array.isArray(children) ? children.length : "なし") +
      " labels=" + (Array.isArray(children) ? children.map((c) => rowLabel(c) || "?").join("|") : "-")
    );
    if (Array.isArray(children) && children.length) {
      if (children.some((c) => c?.key === KEY)) return;
      const template = children.find((c) => c?.type && c?.props?.icon);
      if (!template) { dbg("templateなし"); return; }
      const tIcon = template.props?.icon;
      const row = React.createElement(template.type, {
        key: KEY,
        label: LABEL,
        onPress,
        icon: tIcon
          ? {
              $$typeof: tIcon.$$typeof,
              type: tIcon.type,
              key: null,
              ref: null,
              props: {
                IconComponent: () =>
                  React.createElement(ReactNative.Image, {
                    resizeMode: "cover",
                    style: { width: 24, height: 24 },
                    source: iconId,
                  }),
              },
            }
          : undefined,
      });
      // 「画像を保存」の次、なければ最初の「コピー」系の次
      let i = children.findIndex((c) => /画像を保存|save image/i.test(rowLabel(c)));
      if (i === -1) i = children.findIndex((c) => /コピー|copy/i.test(rowLabel(c)));
      if (i !== -1) children.splice(i + 1, 0, row);
      else children.push(row);
      dbg("グループに追加 i=" + i + " len=" + children.length);
      return;
    }

    // 旧レイアウト: ButtonRow / ActionSheetRow の配列
    const buttons = findInReactTree(
      sheet,
      (x) =>
        Array.isArray(x) &&
        x.some((c) => c?.type?.name === "ButtonRow" || c?.type?.name === "ActionSheetRow")
    );
    if (Array.isArray(buttons)) {
      if (buttons.some((c) => c?.key === KEY)) return;
      dbg("旧レイアウトに追加 len=" + buttons.length);
      buttons.push(
        React.createElement(Forms.FormRow, {
          key: KEY,
          label: LABEL,
          leading: React.createElement(Forms.FormIcon, { style: { opacity: 1 }, source: iconId }),
          onPress,
        })
      );
    } else {
      dbg("未知のActionSheet構造\n" + dumpTree(sheet));
    }
  }

  unpatches.push(
    before("openLazy", ActionSheet, ([component, key, msg]) => {
      const message = msg?.message;
      dbg("sheet: " + key + " msg=" + !!message);
      if (key !== "MessageLongPressActionSheet" || !message) return;
      const url = findImageUrl(message);
      dbg("url=" + (url ? "あり" : "なし att=" + message.attachments?.length + " emb=" + message.embeds?.length));
      if (!url) { flush(); return; }

      Promise.resolve(component)
        .then((instance) => {
          if (!instance || typeof instance.default !== "function") return;
          const unpatch = after("default", instance, (_, sheet) => {
            React.useEffect(() => () => unpatch(), []);
            try {
              dbg("inject開始");
              inject(sheet, url);
              dbg("inject完了"); flush();
            } catch (e) {
              console.error("[CopyImage]", e);
              dbg("injectエラー: " + (e?.message ?? e)); flush();
            }
          });
        })
        .catch(() => {});
    })
  );

  return { onUnload: () => unpatches.forEach((u) => u()) };
})();
