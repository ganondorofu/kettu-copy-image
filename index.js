(function () {
  const { before, after } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { React, clipboard } = vendetta.metro.common;
  const { getAssetIDByName } = vendetta.ui.assets;
  const { showToast } = vendetta.ui.toasts;

  const ActionSheet = findByProps("openLazy", "hideActionSheet");
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

  function makeRow(base, url) {
    const icon = getAssetIDByName("ic_message_copy");
    const props = { key: "copy-image", label: "画像をコピー", onPress: () => copyImage(url) };
    // ActionSheetRow 系は icon、FormRow 系は leading
    if (React.isValidElement(base.props.icon))
      props.icon = React.cloneElement(base.props.icon, { source: icon });
    if (React.isValidElement(base.props.leading))
      props.leading = React.cloneElement(base.props.leading, { source: icon });
    return React.cloneElement(base, props);
  }

  unpatches.push(
    before("openLazy", ActionSheet, ([component, key]) => {
      if (key !== "MediaShareActionSheet") return;
      component.then((instance) => {
        const unpatch = after("default", instance, ([{ syncer }], res) => {
          React.useEffect(() => () => unpatch(), []);
          try {
            let source = syncer.sources[syncer.index.value];
            if (Array.isArray(source)) source = source[0];
            const url = source.sourceURI ?? source.uri;
            const rows = res?.props?.children?.props?.children;
            if (!url || !Array.isArray(rows) || rows.some((r) => r?.key === "copy-image")) return;

            const idx = rows.findIndex((r) => /save|保存/i.test(String(r?.props?.label ?? "")));
            const base = rows[idx >= 0 ? idx : 0];
            if (!base?.props) return;
            rows.splice(idx >= 0 ? idx + 1 : rows.length, 0, makeRow(base, url));
          } catch (e) {
            console.error("[CopyImage]", e);
          }
        });
      });
    })
  );

  return { onUnload: () => unpatches.forEach((u) => u()) };
})();
