(function () {
  const { before, after } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { React, ReactNative, clipboard } = vendetta.metro.common;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { findInReactTree } = vendetta.utils;
  const { Forms } = vendetta.ui.components;

  const ActionSheet = findByProps("openLazy", "hideActionSheet");
  const LABEL = "画像をコピー";
  const KEY = "copy-image";
  const unpatches = [];
  let buf = [];
  const dbg = (m) => {
    console.log("[CopyImage] " + m);
    buf.push(m);
  };
  const flush = () => {
    const text = buf.join("\n");
    buf = [];
    try { ReactNative.Alert.alert("CopyImage診断", text); } catch (e) { showToast(text); }
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
    ActionSheet.hideActionSheet();
    try {
      if (typeof clipboard.setImage !== "function")
        throw new Error("このクライアントは画像コピー非対応");
      clipboard.setImage(await toBase64(url));
      showToast("画像をコピーしました", getAssetIDByName("ic_message_copy"));
    } catch (e) {
      showToast("コピー失敗: " + (e?.message ?? e), getAssetIDByName("Small"));
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
    const groups = findInReactTree(
      sheet,
      (x) => Array.isArray(x) && x[0]?.type?.name === "ActionSheetRowGroup"
    );
    const children = groups?.[1]?.props?.children;
    dbg(
      "groups=" + (groups ? groups.length : "なし") +
      " g1children=" + (Array.isArray(children) ? children.length : typeof children) +
      " labels=" + (Array.isArray(children) ? children.map((c) => c?.props?.label ?? c?.props?.message ?? c?.type?.name ?? "?").join("|") : "-")
    );
    if (Array.isArray(children) && children.length) {
      if (children.some((c) => c?.key === KEY)) return;
      const template = children.find((c) => c?.type);
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
      const i = children.findIndex(
        (c) =>
          String(c?.props?.label ?? "").toUpperCase().includes("COPY") ||
          String(c?.props?.message ?? "").toUpperCase().includes("COPY")
      );
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
