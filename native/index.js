(function () {
  const { before, after } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { React, ReactNative, clipboard } = vendetta.metro.common;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { findInReactTree } = vendetta.utils;

  const ActionSheet = findByProps("openLazy", "hideActionSheet");
  const LABEL = "画像をコピー";
  const KEY = "copy-image-native";
  const unpatches = [];

  // KettuXposed のブリッジ: {revenge:{method,args}} をフックされたネイティブ関数に渡す
  async function bridge(method, args) {
    const nm = globalThis.nativeModuleProxy ?? ReactNative.NativeModules;
    const payload = { revenge: { method, args } };
    let res;
    if (nm?.FileReaderModule?.readAsDataURL) {
      res = await nm.FileReaderModule.readAsDataURL(payload);
    } else if (nm?.RNSVGRenderableManager?.getBBox) {
      res = nm.RNSVGRenderableManager.getBBox(0, payload);
    } else {
      throw new Error("ブリッジ用のネイティブモジュールが見つかりません");
    }
    if (!res || typeof res !== "object" || !("result" in res || "error" in res))
      throw new Error("KettuXposed の画像コピー対応版が入っていません");
    if (res.error) throw new Error(res.error);
    return res.result;
  }

  function fetchAsBase64(url) {
    return fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onloadend = () =>
              resolve({ base64: String(reader.result).split(",")[1], type: blob.type });
          })
      );
  }

  async function copyImage(url) {
    try { ActionSheet.hideActionSheet(); } catch {}
    try {
      const { base64, type } = await fetchAsBase64(url);
      await bridge("kettu.clipboard.copyImage", [base64, type || "image/jpeg"]);
      showToast("画像をコピーしました", getAssetIDByName("ic_message_copy"));
    } catch (e) {
      const msg = String(e?.message ?? e);
      console.log("[CopyImage] " + msg);
      // 原因を確認できるよう、エラー全文をクリップボードに入れる
      try { clipboard.setString("CopyImage error\n" + msg); } catch {}
      showToast("コピー失敗: " + msg.split("\n")[0].slice(0, 120), getAssetIDByName("Small"));
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

  function inject(sheet, url) {
    const iconId = getAssetIDByName("ic_message_copy") ?? getAssetIDByName("copy");
    const rowLabel = (c) => String(c?.props?.label ?? c?.props?.message ?? "");

    // 型名は最小化されるので使わず、アイコン付きで「コピー」系ラベルの行を含む配列を探す
    const rows = findInReactTree(
      sheet,
      (x) =>
        Array.isArray(x) &&
        x.some((c) => c?.type && c?.props?.icon) &&
        x.some((c) => /コピー|copy/i.test(rowLabel(c)))
    );
    if (!Array.isArray(rows) || rows.some((c) => c?.key === KEY)) return;

    const template = rows.find((c) => c?.type && c?.props?.icon);
    if (!template) return;
    const tIcon = template.props.icon;

    const row = React.createElement(template.type, {
      key: KEY,
      label: LABEL,
      onPress: () => copyImage(url),
      icon: {
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
      },
    });

    // 「画像を保存」の次、なければ最初の「コピー」系の次
    let i = rows.findIndex((c) => /画像を保存|save image/i.test(rowLabel(c)));
    if (i === -1) i = rows.findIndex((c) => /コピー|copy/i.test(rowLabel(c)));
    rows.splice(i + 1, 0, row);
  }

  unpatches.push(
    before("openLazy", ActionSheet, ([component, key, msg]) => {
      const message = msg?.message;
      if (key !== "MessageLongPressActionSheet" || !message) return;
      const url = findImageUrl(message);
      if (!url) return;

      Promise.resolve(component)
        .then((instance) => {
          if (!instance || typeof instance.default !== "function") return;
          const unpatch = after("default", instance, (_, sheet) => {
            React.useEffect(() => () => unpatch(), []);
            try {
              inject(sheet, url);
            } catch (e) {
              console.error("[CopyImage]", e);
            }
          });
        })
        .catch(() => {});
    })
  );

  return { onUnload: () => unpatches.forEach((u) => u()) };
})();
