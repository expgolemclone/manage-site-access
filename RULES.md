# Repository Rules

- mainへpushしたら, GitHub Releaseの公開まで行う. 未完了taskのhandoff/*は対象外とする.
- releaseはpushしたcommitを対象とし, `build.ps1` で生成した `dist/manage-site-access.user.js` を添付する.
- release tagはuserscriptの`@version`に`v`を付ける. 既存releaseは上書きせず, 次回releaseではversionを更新する.
- test成功と公開assetの一致を確認するまで完了としない.
