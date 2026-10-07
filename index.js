(function () {
  const { before, after } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { React, clipboard } = vendetta.metro.common;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;
  const { findInReactTree } = vendetta.utils;

  const ActionSheet = findByProps("openLazy", "hideActionSheet");
  const ActionSheetRow =
    findByProps("ActionSheetRow")?.ActionSheetRow ?? vendetta.ui.components.Forms.FormRow;
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

  unpatches.push(
    before("openLazy", ActionSheet, ([component, key, msg]) => {
      const message = msg?.message;
      if (key !== "MessageLongPressActionSheet" || !message) return;
      const url = findImageUrl(message);
      if (!url) return;

      component.then((instance) => {
        const unpatch = after("default", instance, (_, res) => {
          React.useEffect(() => () => unpatch(), []);
          try {
            const buttons = findInReactTree(
              res,
              (c) =>
                Array.isArray(c) &&
                c.some((x) => x?.type?.name === "ButtonRow" || x?.type?.name === "ActionSheetRow")
            );
            if (!buttons || buttons.some((b) => b?.props?.label === "画像をコピー")) return;

            const icon = getAssetIDByName("ic_message_copy");
            const props = { label: "画像をコピー", onPress: () => copyImage(url) };
            if (ActionSheetRow.Icon)
              props.icon = React.createElement(ActionSheetRow.Icon, { source: icon });
            else props.leading = React.createElement(vendetta.ui.components.Forms.FormIcon, { source: icon });
            buttons.push(React.createElement(ActionSheetRow, props));
          } catch (e) {
            console.error("[CopyImage]", e);
          }
        });
      });
    })
  );

  return { onUnload: () => unpatches.forEach((u) => u()) };
})();
