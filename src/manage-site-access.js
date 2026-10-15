// ==UserScript==
// @name         Manage Site Access
// @namespace    https://github.com/expgolemclone/manage-site-access
// @version      1.0.0
// @description  Block configured sites and paths while leaving other services available.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const rules = __SITE_RULES__;
  const host = location.hostname.toLowerCase().replace(/\.$/, "");
  const activeRules = rules.filter((rule) =>
    rule.hosts.some((candidate) =>
      host === candidate ||
      (rule.includeSubdomains && host.endsWith("." + candidate))
    )
  );
  if (activeRules.length === 0) return;

  function block() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (!activeRules.some((rule) =>
      rule.paths.length === 0 || rule.paths.includes(path)
    )) return false;

    location.replace("about:blank");
    return true;
  }

  if (block()) return;
  addEventListener("pageshow", block);
  addEventListener("popstate", block);
  // History API navigation does not dispatch popstate.
  setInterval(block, 500);
})();
