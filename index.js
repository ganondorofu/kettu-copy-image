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

  function findImageUrl(message) {
    const att = message.attachments?.find(
      (a) => a.content_type?.startsWith("image/") || (a.width && a.height)
    );
    return (
      att?.url ??
      message.embeds?.find((e) => e.image?.url)?.image?.url ??
      message.embeds?.find((e) => e.thumbnail?.url)?.thumbnail?.url
    );
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
    if (Array.isArray(children) && children.length) {
      if (children.some((c) => c?.key === KEY)) return;
      const template = children.find((c) => c?.type);
      if (!template) return;
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
      buttons.push(
        React.createElement(Forms.FormRow, {
          key: KEY,
          label: LABEL,
          leading: React.createElement(Forms.FormIcon, { style: { opacity: 1 }, source: iconId }),
          onPress,
        })
      );
    } else {
      console.log("[CopyImage] 未知のActionSheet構造");
    }
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
