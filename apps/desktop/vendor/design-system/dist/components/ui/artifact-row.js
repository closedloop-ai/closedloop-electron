var React = require("react");
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs
var require_interop_require_wildcard = __commonJS({
  "../../node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs"(exports2) {
    "use strict";
    function _getRequireWildcardCache(nodeInterop) {
      if (typeof WeakMap !== "function") return null;
      var cacheBabelInterop = /* @__PURE__ */ new WeakMap();
      var cacheNodeInterop = /* @__PURE__ */ new WeakMap();
      return (_getRequireWildcardCache = function(nodeInterop2) {
        return nodeInterop2 ? cacheNodeInterop : cacheBabelInterop;
      })(nodeInterop);
    }
    function _interop_require_wildcard(obj, nodeInterop) {
      if (!nodeInterop && obj && obj.__esModule) return obj;
      if (obj === null || typeof obj !== "object" && typeof obj !== "function") return { default: obj };
      var cache = _getRequireWildcardCache(nodeInterop);
      if (cache && cache.has(obj)) return cache.get(obj);
      var newObj = { __proto__: null };
      var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var key in obj) {
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
          var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
          if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key, desc);
          else newObj[key] = obj[key];
        }
      }
      newObj.default = obj;
      if (cache) cache.set(obj, newObj);
      return newObj;
    }
    exports2._ = _interop_require_wildcard;
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/querystring.js
var require_querystring = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/querystring.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      assign: function() {
        return assign;
      },
      searchParamsToUrlQuery: function() {
        return searchParamsToUrlQuery;
      },
      urlQueryToSearchParams: function() {
        return urlQueryToSearchParams;
      }
    });
    function searchParamsToUrlQuery(searchParams) {
      const query = {};
      for (const [key, value] of searchParams.entries()) {
        const existing = query[key];
        if (typeof existing === "undefined") {
          query[key] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          query[key] = [
            existing,
            value
          ];
        }
      }
      return query;
    }
    function stringifyUrlQueryParam(param) {
      if (typeof param === "string") {
        return param;
      }
      if (typeof param === "number" && !isNaN(param) || typeof param === "boolean") {
        return String(param);
      } else {
        return "";
      }
    }
    function urlQueryToSearchParams(query) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, stringifyUrlQueryParam(item));
          }
        } else {
          searchParams.set(key, stringifyUrlQueryParam(value));
        }
      }
      return searchParams;
    }
    function assign(target, ...searchParamsList) {
      for (const searchParams of searchParamsList) {
        for (const key of searchParams.keys()) {
          target.delete(key);
        }
        for (const [key, value] of searchParams.entries()) {
          target.append(key, value);
        }
      }
      return target;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/format-url.js
var require_format_url = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/format-url.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      formatUrl: function() {
        return formatUrl;
      },
      formatWithValidation: function() {
        return formatWithValidation;
      },
      urlObjectKeys: function() {
        return urlObjectKeys;
      }
    });
    var _interop_require_wildcard = require_interop_require_wildcard();
    var _querystring = /* @__PURE__ */ _interop_require_wildcard._(require_querystring());
    var slashedProtocols = /https?|ftp|gopher|file/;
    function formatUrl(urlObj) {
      let { auth, hostname } = urlObj;
      let protocol = urlObj.protocol || "";
      let pathname = urlObj.pathname || "";
      let hash = urlObj.hash || "";
      let query = urlObj.query || "";
      let host = false;
      auth = auth ? encodeURIComponent(auth).replace(/%3A/i, ":") + "@" : "";
      if (urlObj.host) {
        host = auth + urlObj.host;
      } else if (hostname) {
        host = auth + (~hostname.indexOf(":") ? `[${hostname}]` : hostname);
        if (urlObj.port) {
          host += ":" + urlObj.port;
        }
      }
      if (query && typeof query === "object") {
        query = String(_querystring.urlQueryToSearchParams(query));
      }
      let search = urlObj.search || query && `?${query}` || "";
      if (protocol && !protocol.endsWith(":")) protocol += ":";
      if (urlObj.slashes || (!protocol || slashedProtocols.test(protocol)) && host !== false) {
        host = "//" + (host || "");
        if (pathname && pathname[0] !== "/") pathname = "/" + pathname;
      } else if (!host) {
        host = "";
      }
      if (hash && hash[0] !== "#") hash = "#" + hash;
      if (search && search[0] !== "?") search = "?" + search;
      pathname = pathname.replace(/[?#]/g, encodeURIComponent);
      search = search.replace("#", "%23");
      return `${protocol}${host}${pathname}${search}${hash}`;
    }
    var urlObjectKeys = [
      "auth",
      "hash",
      "host",
      "hostname",
      "href",
      "path",
      "pathname",
      "port",
      "protocol",
      "query",
      "search",
      "slashes"
    ];
    function formatWithValidation(url) {
      if (process.env.NODE_ENV === "development") {
        if (url !== null && typeof url === "object") {
          Object.keys(url).forEach((key) => {
            if (!urlObjectKeys.includes(key)) {
              console.warn(`Unknown key passed via urlObject into url.format: ${key}`);
            }
          });
        }
      }
      return formatUrl(url);
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/omit.js
var require_omit = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/omit.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "omit", {
      enumerable: true,
      get: function() {
        return omit;
      }
    });
    function omit(object, keys) {
      const omitted = {};
      Object.keys(object).forEach((key) => {
        if (!keys.includes(key)) {
          omitted[key] = object[key];
        }
      });
      return omitted;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      DecodeError: function() {
        return DecodeError;
      },
      MiddlewareNotFoundError: function() {
        return MiddlewareNotFoundError;
      },
      MissingStaticPage: function() {
        return MissingStaticPage;
      },
      NormalizeError: function() {
        return NormalizeError;
      },
      PageNotFoundError: function() {
        return PageNotFoundError;
      },
      SP: function() {
        return SP;
      },
      ST: function() {
        return ST;
      },
      WEB_VITALS: function() {
        return WEB_VITALS;
      },
      execOnce: function() {
        return execOnce;
      },
      getDisplayName: function() {
        return getDisplayName;
      },
      getLocationOrigin: function() {
        return getLocationOrigin;
      },
      getURL: function() {
        return getURL;
      },
      isAbsoluteUrl: function() {
        return isAbsoluteUrl;
      },
      isResSent: function() {
        return isResSent;
      },
      loadGetInitialProps: function() {
        return loadGetInitialProps;
      },
      normalizeRepeatedSlashes: function() {
        return normalizeRepeatedSlashes;
      },
      stringifyError: function() {
        return stringifyError;
      }
    });
    var WEB_VITALS = [
      "CLS",
      "FCP",
      "FID",
      "INP",
      "LCP",
      "TTFB"
    ];
    function execOnce(fn) {
      let used = false;
      let result;
      return (...args) => {
        if (!used) {
          used = true;
          result = fn(...args);
        }
        return result;
      };
    }
    var ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*?:/;
    var isAbsoluteUrl = (url) => ABSOLUTE_URL_REGEX.test(url);
    function getLocationOrigin() {
      const { protocol, hostname, port } = window.location;
      return `${protocol}//${hostname}${port ? ":" + port : ""}`;
    }
    function getURL() {
      const { href } = window.location;
      const origin = getLocationOrigin();
      return href.substring(origin.length);
    }
    function getDisplayName(Component) {
      return typeof Component === "string" ? Component : Component.displayName || Component.name || "Unknown";
    }
    function isResSent(res) {
      return res.finished || res.headersSent;
    }
    function normalizeRepeatedSlashes(url) {
      const urlParts = url.split("?");
      const urlNoQuery = urlParts[0];
      return urlNoQuery.replace(/\\/g, "/").replace(/\/\/+/g, "/") + (urlParts[1] ? `?${urlParts.slice(1).join("?")}` : "");
    }
    async function loadGetInitialProps(App, ctx) {
      if (process.env.NODE_ENV !== "production") {
        if (App.prototype?.getInitialProps) {
          const message = `"${getDisplayName(App)}.getInitialProps()" is defined as an instance method - visit https://nextjs.org/docs/messages/get-initial-props-as-an-instance-method for more information.`;
          throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
            value: "E1035",
            enumerable: false,
            configurable: true
          });
        }
      }
      const res = ctx.res || ctx.ctx && ctx.ctx.res;
      if (!App.getInitialProps) {
        if (ctx.ctx && ctx.Component) {
          return {
            pageProps: await loadGetInitialProps(ctx.Component, ctx.ctx)
          };
        }
        return {};
      }
      const props = await App.getInitialProps(ctx);
      if (res && isResSent(res)) {
        return props;
      }
      if (!props) {
        const message = `"${getDisplayName(App)}.getInitialProps()" should resolve to an object. But found "${props}" instead.`;
        throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
          value: "E1025",
          enumerable: false,
          configurable: true
        });
      }
      if (process.env.NODE_ENV !== "production") {
        if (Object.keys(props).length === 0 && !ctx.ctx) {
          console.warn(`${getDisplayName(App)} returned an empty object from \`getInitialProps\`. This de-optimizes and prevents automatic static optimization. https://nextjs.org/docs/messages/empty-object-getInitialProps`);
        }
      }
      return props;
    }
    var SP = typeof performance !== "undefined";
    var ST = SP && [
      "mark",
      "measure",
      "getEntriesByName"
    ].every((method) => typeof performance[method] === "function");
    var DecodeError = class extends Error {
    };
    var NormalizeError = class extends Error {
    };
    var PageNotFoundError = class extends Error {
      constructor(page) {
        super();
        this.code = "ENOENT";
        this.name = "PageNotFoundError";
        this.message = `Cannot find module for page: ${page}`;
      }
    };
    var MissingStaticPage = class extends Error {
      constructor(page, message) {
        super();
        this.message = `Failed to load static file for page: ${page} ${message}`;
      }
    };
    var MiddlewareNotFoundError = class extends Error {
      constructor() {
        super();
        this.code = "ENOENT";
        this.message = `Cannot find the middleware module`;
      }
    };
    function stringifyError(error) {
      return JSON.stringify({
        message: error.message,
        stack: error.stack
      });
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/remove-trailing-slash.js
var require_remove_trailing_slash = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/remove-trailing-slash.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "removeTrailingSlash", {
      enumerable: true,
      get: function() {
        return removeTrailingSlash;
      }
    });
    function removeTrailingSlash(route) {
      return route.replace(/\/$/, "") || "/";
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/parse-path.js
var require_parse_path = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/parse-path.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "parsePath", {
      enumerable: true,
      get: function() {
        return parsePath;
      }
    });
    function parsePath(path) {
      const hashIndex = path.indexOf("#");
      const queryIndex = path.indexOf("?");
      const hasQuery = queryIndex > -1 && (hashIndex < 0 || queryIndex < hashIndex);
      if (hasQuery || hashIndex > -1) {
        return {
          pathname: path.substring(0, hasQuery ? queryIndex : hashIndex),
          query: hasQuery ? path.substring(queryIndex, hashIndex > -1 ? hashIndex : void 0) : "",
          hash: hashIndex > -1 ? path.slice(hashIndex) : ""
        };
      }
      return {
        pathname: path,
        query: "",
        hash: ""
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/normalize-trailing-slash.js
var require_normalize_trailing_slash = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/normalize-trailing-slash.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "normalizePathTrailingSlash", {
      enumerable: true,
      get: function() {
        return normalizePathTrailingSlash;
      }
    });
    var _removetrailingslash = require_remove_trailing_slash();
    var _parsepath = require_parse_path();
    var normalizePathTrailingSlash = (path) => {
      if (!path.startsWith("/") || process.env.__NEXT_MANUAL_TRAILING_SLASH) {
        return path;
      }
      const { pathname, query, hash } = (0, _parsepath.parsePath)(path);
      if (process.env.__NEXT_TRAILING_SLASH) {
        if (/\.[^/]+\/?$/.test(pathname)) {
          return `${(0, _removetrailingslash.removeTrailingSlash)(pathname)}${query}${hash}`;
        } else if (pathname.endsWith("/")) {
          return `${pathname}${query}${hash}`;
        } else {
          return `${pathname}/${query}${hash}`;
        }
      }
      return `${(0, _removetrailingslash.removeTrailingSlash)(pathname)}${query}${hash}`;
    };
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/path-has-prefix.js
var require_path_has_prefix = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/path-has-prefix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "pathHasPrefix", {
      enumerable: true,
      get: function() {
        return pathHasPrefix;
      }
    });
    var _parsepath = require_parse_path();
    function pathHasPrefix(path, prefix) {
      if (typeof path !== "string") {
        return false;
      }
      const { pathname } = (0, _parsepath.parsePath)(path);
      return pathname === prefix || pathname.startsWith(prefix + "/");
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/has-base-path.js
var require_has_base_path = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/has-base-path.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "hasBasePath", {
      enumerable: true,
      get: function() {
        return hasBasePath;
      }
    });
    var _pathhasprefix = require_path_has_prefix();
    var basePath = process.env.__NEXT_ROUTER_BASEPATH || "";
    function hasBasePath(path) {
      return (0, _pathhasprefix.pathHasPrefix)(path, basePath);
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/is-local-url.js
var require_is_local_url = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/is-local-url.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "isLocalURL", {
      enumerable: true,
      get: function() {
        return isLocalURL;
      }
    });
    var _utils = require_utils();
    var _hasbasepath = require_has_base_path();
    function isLocalURL(url) {
      if (!(0, _utils.isAbsoluteUrl)(url)) return true;
      try {
        const locationOrigin = (0, _utils.getLocationOrigin)();
        const resolved = new URL(url, locationOrigin);
        return resolved.origin === locationOrigin && (0, _hasbasepath.hasBasePath)(resolved.pathname);
      } catch (_) {
        return false;
      }
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/sorted-routes.js
var require_sorted_routes = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/sorted-routes.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      getSortedRouteObjects: function() {
        return getSortedRouteObjects;
      },
      getSortedRoutes: function() {
        return getSortedRoutes;
      }
    });
    var UrlNode = class _UrlNode {
      insert(urlPath) {
        this._insert(urlPath.split("/").filter(Boolean), [], false);
      }
      smoosh() {
        return this._smoosh();
      }
      _smoosh(prefix = "/") {
        const childrenPaths = [
          ...this.children.keys()
        ].sort();
        if (this.slugName !== null) {
          childrenPaths.splice(childrenPaths.indexOf("[]"), 1);
        }
        if (this.restSlugName !== null) {
          childrenPaths.splice(childrenPaths.indexOf("[...]"), 1);
        }
        if (this.optionalRestSlugName !== null) {
          childrenPaths.splice(childrenPaths.indexOf("[[...]]"), 1);
        }
        const routes = childrenPaths.map((c) => this.children.get(c)._smoosh(`${prefix}${c}/`)).reduce((prev, curr) => [
          ...prev,
          ...curr
        ], []);
        if (this.slugName !== null) {
          routes.push(...this.children.get("[]")._smoosh(`${prefix}[${this.slugName}]/`));
        }
        if (!this.placeholder) {
          const r = prefix === "/" ? "/" : prefix.slice(0, -1);
          if (this.optionalRestSlugName != null) {
            throw Object.defineProperty(new Error(`You cannot define a route with the same specificity as a optional catch-all route ("${r}" and "${r}[[...${this.optionalRestSlugName}]]").`), "__NEXT_ERROR_CODE", {
              value: "E458",
              enumerable: false,
              configurable: true
            });
          }
          routes.unshift(r);
        }
        if (this.restSlugName !== null) {
          routes.push(...this.children.get("[...]")._smoosh(`${prefix}[...${this.restSlugName}]/`));
        }
        if (this.optionalRestSlugName !== null) {
          routes.push(...this.children.get("[[...]]")._smoosh(`${prefix}[[...${this.optionalRestSlugName}]]/`));
        }
        return routes;
      }
      _insert(urlPaths, slugNames, isCatchAll) {
        if (urlPaths.length === 0) {
          this.placeholder = false;
          return;
        }
        if (isCatchAll) {
          throw Object.defineProperty(new Error(`Catch-all must be the last part of the URL.`), "__NEXT_ERROR_CODE", {
            value: "E392",
            enumerable: false,
            configurable: true
          });
        }
        let nextSegment = urlPaths[0];
        if (nextSegment.startsWith("[") && nextSegment.endsWith("]")) {
          let handleSlug = function(previousSlug, nextSlug) {
            if (previousSlug !== null) {
              if (previousSlug !== nextSlug) {
                throw Object.defineProperty(new Error(`You cannot use different slug names for the same dynamic path ('${previousSlug}' !== '${nextSlug}').`), "__NEXT_ERROR_CODE", {
                  value: "E337",
                  enumerable: false,
                  configurable: true
                });
              }
            }
            slugNames.forEach((slug) => {
              if (slug === nextSlug) {
                throw Object.defineProperty(new Error(`You cannot have the same slug name "${nextSlug}" repeat within a single dynamic path`), "__NEXT_ERROR_CODE", {
                  value: "E247",
                  enumerable: false,
                  configurable: true
                });
              }
              if (slug.replace(/\W/g, "") === nextSegment.replace(/\W/g, "")) {
                throw Object.defineProperty(new Error(`You cannot have the slug names "${slug}" and "${nextSlug}" differ only by non-word symbols within a single dynamic path`), "__NEXT_ERROR_CODE", {
                  value: "E499",
                  enumerable: false,
                  configurable: true
                });
              }
            });
            slugNames.push(nextSlug);
          };
          let segmentName = nextSegment.slice(1, -1);
          let isOptional = false;
          if (segmentName.startsWith("[") && segmentName.endsWith("]")) {
            segmentName = segmentName.slice(1, -1);
            isOptional = true;
          }
          if (segmentName.startsWith("\u2026")) {
            throw Object.defineProperty(new Error(`Detected a three-dot character ('\u2026') at ('${segmentName}'). Did you mean ('...')?`), "__NEXT_ERROR_CODE", {
              value: "E147",
              enumerable: false,
              configurable: true
            });
          }
          if (segmentName.startsWith("...")) {
            segmentName = segmentName.substring(3);
            isCatchAll = true;
          }
          if (segmentName.startsWith("[") || segmentName.endsWith("]")) {
            throw Object.defineProperty(new Error(`Segment names may not start or end with extra brackets ('${segmentName}').`), "__NEXT_ERROR_CODE", {
              value: "E421",
              enumerable: false,
              configurable: true
            });
          }
          if (segmentName.startsWith(".")) {
            throw Object.defineProperty(new Error(`Segment names may not start with erroneous periods ('${segmentName}').`), "__NEXT_ERROR_CODE", {
              value: "E288",
              enumerable: false,
              configurable: true
            });
          }
          if (isCatchAll) {
            if (isOptional) {
              if (this.restSlugName != null) {
                throw Object.defineProperty(new Error(`You cannot use both an required and optional catch-all route at the same level ("[...${this.restSlugName}]" and "${urlPaths[0]}" ).`), "__NEXT_ERROR_CODE", {
                  value: "E299",
                  enumerable: false,
                  configurable: true
                });
              }
              handleSlug(this.optionalRestSlugName, segmentName);
              this.optionalRestSlugName = segmentName;
              nextSegment = "[[...]]";
            } else {
              if (this.optionalRestSlugName != null) {
                throw Object.defineProperty(new Error(`You cannot use both an optional and required catch-all route at the same level ("[[...${this.optionalRestSlugName}]]" and "${urlPaths[0]}").`), "__NEXT_ERROR_CODE", {
                  value: "E300",
                  enumerable: false,
                  configurable: true
                });
              }
              handleSlug(this.restSlugName, segmentName);
              this.restSlugName = segmentName;
              nextSegment = "[...]";
            }
          } else {
            if (isOptional) {
              throw Object.defineProperty(new Error(`Optional route parameters are not yet supported ("${urlPaths[0]}").`), "__NEXT_ERROR_CODE", {
                value: "E435",
                enumerable: false,
                configurable: true
              });
            }
            handleSlug(this.slugName, segmentName);
            this.slugName = segmentName;
            nextSegment = "[]";
          }
        }
        if (!this.children.has(nextSegment)) {
          this.children.set(nextSegment, new _UrlNode());
        }
        this.children.get(nextSegment)._insert(urlPaths.slice(1), slugNames, isCatchAll);
      }
      constructor() {
        this.placeholder = true;
        this.children = /* @__PURE__ */ new Map();
        this.slugName = null;
        this.restSlugName = null;
        this.optionalRestSlugName = null;
      }
    };
    function getSortedRoutes(normalizedPages) {
      const root = new UrlNode();
      normalizedPages.forEach((pagePath) => root.insert(pagePath));
      return root.smoosh();
    }
    function getSortedRouteObjects(objects, getter) {
      const indexes = {};
      const pathnames = [];
      for (let i = 0; i < objects.length; i++) {
        const pathname = getter(objects[i]);
        indexes[pathname] = i;
        pathnames[i] = pathname;
      }
      const sorted = getSortedRoutes(pathnames);
      return sorted.map((pathname) => objects[indexes[pathname]]);
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/page-path/ensure-leading-slash.js
var require_ensure_leading_slash = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/page-path/ensure-leading-slash.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "ensureLeadingSlash", {
      enumerable: true,
      get: function() {
        return ensureLeadingSlash;
      }
    });
    function ensureLeadingSlash(path) {
      return path.startsWith("/") ? path : `/${path}`;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/segment.js
var require_segment = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/segment.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      DEFAULT_SEGMENT_KEY: function() {
        return DEFAULT_SEGMENT_KEY;
      },
      NOT_FOUND_SEGMENT_KEY: function() {
        return NOT_FOUND_SEGMENT_KEY;
      },
      PAGE_SEGMENT_KEY: function() {
        return PAGE_SEGMENT_KEY;
      },
      addSearchParamsIfPageSegment: function() {
        return addSearchParamsIfPageSegment;
      },
      computeSelectedLayoutSegment: function() {
        return computeSelectedLayoutSegment;
      },
      getSegmentValue: function() {
        return getSegmentValue;
      },
      getSelectedLayoutSegmentPath: function() {
        return getSelectedLayoutSegmentPath;
      },
      isGroupSegment: function() {
        return isGroupSegment;
      },
      isParallelRouteSegment: function() {
        return isParallelRouteSegment;
      }
    });
    function getSegmentValue(segment) {
      return Array.isArray(segment) ? segment[1] : segment;
    }
    function isGroupSegment(segment) {
      return segment[0] === "(" && segment.endsWith(")");
    }
    function isParallelRouteSegment(segment) {
      return segment.startsWith("@") && segment !== "@children";
    }
    function addSearchParamsIfPageSegment(segment, searchParams) {
      const isPageSegment = segment.includes(PAGE_SEGMENT_KEY);
      if (isPageSegment) {
        const stringifiedQuery = JSON.stringify(searchParams);
        return stringifiedQuery !== "{}" ? PAGE_SEGMENT_KEY + "?" + stringifiedQuery : PAGE_SEGMENT_KEY;
      }
      return segment;
    }
    function computeSelectedLayoutSegment(segments, parallelRouteKey) {
      if (!segments || segments.length === 0) {
        return null;
      }
      const rawSegment = parallelRouteKey === "children" ? segments[0] : segments[segments.length - 1];
      return rawSegment === DEFAULT_SEGMENT_KEY ? null : rawSegment;
    }
    function getSelectedLayoutSegmentPath(tree, parallelRouteKey, first = true, segmentPath = []) {
      let node;
      if (first) {
        node = tree[1][parallelRouteKey];
      } else {
        const parallelRoutes = tree[1];
        node = parallelRoutes.children ?? Object.values(parallelRoutes)[0];
      }
      if (!node) return segmentPath;
      const segment = node[0];
      let segmentValue = getSegmentValue(segment);
      if (!segmentValue || segmentValue.startsWith(PAGE_SEGMENT_KEY)) {
        return segmentPath;
      }
      segmentPath.push(segmentValue);
      return getSelectedLayoutSegmentPath(node, parallelRouteKey, false, segmentPath);
    }
    var PAGE_SEGMENT_KEY = "__PAGE__";
    var DEFAULT_SEGMENT_KEY = "__DEFAULT__";
    var NOT_FOUND_SEGMENT_KEY = "/_not-found";
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/app-paths.js
var require_app_paths = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/app-paths.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      compareAppPaths: function() {
        return compareAppPaths;
      },
      normalizeAppPath: function() {
        return normalizeAppPath;
      },
      normalizeRscURL: function() {
        return normalizeRscURL;
      }
    });
    var _ensureleadingslash = require_ensure_leading_slash();
    var _segment = require_segment();
    function normalizeAppPath(route) {
      return (0, _ensureleadingslash.ensureLeadingSlash)(route.split("/").reduce((pathname, segment, index, segments) => {
        if (!segment) {
          return pathname;
        }
        if ((0, _segment.isGroupSegment)(segment)) {
          return pathname;
        }
        if (segment[0] === "@") {
          return pathname;
        }
        if ((segment === "page" || segment === "route") && index === segments.length - 1) {
          return pathname;
        }
        return `${pathname}/${segment}`;
      }, ""));
    }
    function compareAppPaths(a, b) {
      const aHasSlot = a.includes("/@");
      const bHasSlot = b.includes("/@");
      if (aHasSlot && !bHasSlot) return -1;
      if (!aHasSlot && bHasSlot) return 1;
      return a.localeCompare(b);
    }
    function normalizeRscURL(url) {
      return url.replace(
        /\.rsc($|\?)/,
        // $1 ensures `?` is preserved
        "$1"
      );
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interception-routes.js
var require_interception_routes = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interception-routes.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      INTERCEPTION_ROUTE_MARKERS: function() {
        return INTERCEPTION_ROUTE_MARKERS;
      },
      extractInterceptionRouteInformation: function() {
        return extractInterceptionRouteInformation;
      },
      isInterceptionRouteAppPath: function() {
        return isInterceptionRouteAppPath;
      }
    });
    var _apppaths = require_app_paths();
    var INTERCEPTION_ROUTE_MARKERS = [
      "(..)(..)",
      "(.)",
      "(..)",
      "(...)"
    ];
    function isInterceptionRouteAppPath(path) {
      return path.split("/").find((segment) => INTERCEPTION_ROUTE_MARKERS.find((m) => segment.startsWith(m))) !== void 0;
    }
    function extractInterceptionRouteInformation(path) {
      let interceptingRoute;
      let marker;
      let interceptedRoute;
      for (const segment of path.split("/")) {
        marker = INTERCEPTION_ROUTE_MARKERS.find((m) => segment.startsWith(m));
        if (marker) {
          ;
          [interceptingRoute, interceptedRoute] = path.split(marker, 2);
          break;
        }
      }
      if (!interceptingRoute || !marker || !interceptedRoute) {
        throw Object.defineProperty(new Error(`Invalid interception route: ${path}. Must be in the format /<intercepting route>/(..|...|..)(..)/<intercepted route>`), "__NEXT_ERROR_CODE", {
          value: "E269",
          enumerable: false,
          configurable: true
        });
      }
      interceptingRoute = (0, _apppaths.normalizeAppPath)(interceptingRoute);
      switch (marker) {
        case "(.)":
          if (interceptingRoute === "/") {
            interceptedRoute = `/${interceptedRoute}`;
          } else {
            interceptedRoute = interceptingRoute + "/" + interceptedRoute;
          }
          break;
        case "(..)":
          if (interceptingRoute === "/") {
            throw Object.defineProperty(new Error(`Invalid interception route: ${path}. Cannot use (..) marker at the root level, use (.) instead.`), "__NEXT_ERROR_CODE", {
              value: "E207",
              enumerable: false,
              configurable: true
            });
          }
          interceptedRoute = interceptingRoute.split("/").slice(0, -1).concat(interceptedRoute).join("/");
          break;
        case "(...)":
          interceptedRoute = "/" + interceptedRoute;
          break;
        case "(..)(..)":
          const splitInterceptingRoute = interceptingRoute.split("/");
          if (splitInterceptingRoute.length <= 2) {
            throw Object.defineProperty(new Error(`Invalid interception route: ${path}. Cannot use (..)(..) marker at the root level or one level up.`), "__NEXT_ERROR_CODE", {
              value: "E486",
              enumerable: false,
              configurable: true
            });
          }
          interceptedRoute = splitInterceptingRoute.slice(0, -2).concat(interceptedRoute).join("/");
          break;
        default:
          throw Object.defineProperty(new Error("Invariant: unexpected marker"), "__NEXT_ERROR_CODE", {
            value: "E112",
            enumerable: false,
            configurable: true
          });
      }
      return {
        interceptingRoute,
        interceptedRoute
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/is-dynamic.js
var require_is_dynamic = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/is-dynamic.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "isDynamicRoute", {
      enumerable: true,
      get: function() {
        return isDynamicRoute;
      }
    });
    var _interceptionroutes = require_interception_routes();
    var TEST_ROUTE = /\/[^/]*\[[^/]+\][^/]*(?=\/|$)/;
    var TEST_STRICT_ROUTE = /\/\[[^/]+\](?=\/|$)/;
    function isDynamicRoute(route, strict = true) {
      if ((0, _interceptionroutes.isInterceptionRouteAppPath)(route)) {
        route = (0, _interceptionroutes.extractInterceptionRouteInformation)(route).interceptedRoute;
      }
      if (strict) {
        return TEST_STRICT_ROUTE.test(route);
      }
      return TEST_ROUTE.test(route);
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/index.js
var require_utils2 = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      getSortedRouteObjects: function() {
        return _sortedroutes.getSortedRouteObjects;
      },
      getSortedRoutes: function() {
        return _sortedroutes.getSortedRoutes;
      },
      isDynamicRoute: function() {
        return _isdynamic.isDynamicRoute;
      }
    });
    var _sortedroutes = require_sorted_routes();
    var _isdynamic = require_is_dynamic();
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/compiled/path-to-regexp/index.js
var require_path_to_regexp = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/compiled/path-to-regexp/index.js"(exports2, module2) {
    "use strict";
    (() => {
      "use strict";
      if (typeof __nccwpck_require__ !== "undefined") __nccwpck_require__.ab = __dirname + "/";
      var e = {};
      (() => {
        var n = e;
        Object.defineProperty(n, "__esModule", { value: true });
        n.pathToRegexp = n.tokensToRegexp = n.regexpToFunction = n.match = n.tokensToFunction = n.compile = n.parse = void 0;
        function lexer(e2) {
          var n2 = [];
          var r = 0;
          while (r < e2.length) {
            var t = e2[r];
            if (t === "*" || t === "+" || t === "?") {
              n2.push({ type: "MODIFIER", index: r, value: e2[r++] });
              continue;
            }
            if (t === "\\") {
              n2.push({ type: "ESCAPED_CHAR", index: r++, value: e2[r++] });
              continue;
            }
            if (t === "{") {
              n2.push({ type: "OPEN", index: r, value: e2[r++] });
              continue;
            }
            if (t === "}") {
              n2.push({ type: "CLOSE", index: r, value: e2[r++] });
              continue;
            }
            if (t === ":") {
              var a = "";
              var i = r + 1;
              while (i < e2.length) {
                var o = e2.charCodeAt(i);
                if (o >= 48 && o <= 57 || o >= 65 && o <= 90 || o >= 97 && o <= 122 || o === 95) {
                  a += e2[i++];
                  continue;
                }
                break;
              }
              if (!a) throw new TypeError("Missing parameter name at ".concat(r));
              n2.push({ type: "NAME", index: r, value: a });
              r = i;
              continue;
            }
            if (t === "(") {
              var c = 1;
              var f = "";
              var i = r + 1;
              if (e2[i] === "?") {
                throw new TypeError('Pattern cannot start with "?" at '.concat(i));
              }
              while (i < e2.length) {
                if (e2[i] === "\\") {
                  f += e2[i++] + e2[i++];
                  continue;
                }
                if (e2[i] === ")") {
                  c--;
                  if (c === 0) {
                    i++;
                    break;
                  }
                } else if (e2[i] === "(") {
                  c++;
                  if (e2[i + 1] !== "?") {
                    throw new TypeError("Capturing groups are not allowed at ".concat(i));
                  }
                }
                f += e2[i++];
              }
              if (c) throw new TypeError("Unbalanced pattern at ".concat(r));
              if (!f) throw new TypeError("Missing pattern at ".concat(r));
              n2.push({ type: "PATTERN", index: r, value: f });
              r = i;
              continue;
            }
            n2.push({ type: "CHAR", index: r, value: e2[r++] });
          }
          n2.push({ type: "END", index: r, value: "" });
          return n2;
        }
        function parse(e2, n2) {
          if (n2 === void 0) {
            n2 = {};
          }
          var r = lexer(e2);
          var t = n2.prefixes, a = t === void 0 ? "./" : t, i = n2.delimiter, o = i === void 0 ? "/#?" : i;
          var c = [];
          var f = 0;
          var u = 0;
          var p = "";
          var tryConsume = function(e3) {
            if (u < r.length && r[u].type === e3) return r[u++].value;
          };
          var mustConsume = function(e3) {
            var n3 = tryConsume(e3);
            if (n3 !== void 0) return n3;
            var t2 = r[u], a2 = t2.type, i2 = t2.index;
            throw new TypeError("Unexpected ".concat(a2, " at ").concat(i2, ", expected ").concat(e3));
          };
          var consumeText = function() {
            var e3 = "";
            var n3;
            while (n3 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
              e3 += n3;
            }
            return e3;
          };
          var isSafe = function(e3) {
            for (var n3 = 0, r2 = o; n3 < r2.length; n3++) {
              var t2 = r2[n3];
              if (e3.indexOf(t2) > -1) return true;
            }
            return false;
          };
          var safePattern = function(e3) {
            var n3 = c[c.length - 1];
            var r2 = e3 || (n3 && typeof n3 === "string" ? n3 : "");
            if (n3 && !r2) {
              throw new TypeError('Must have text between two parameters, missing text after "'.concat(n3.name, '"'));
            }
            if (!r2 || isSafe(r2)) return "[^".concat(escapeString(o), "]+?");
            return "(?:(?!".concat(escapeString(r2), ")[^").concat(escapeString(o), "])+?");
          };
          while (u < r.length) {
            var v = tryConsume("CHAR");
            var s = tryConsume("NAME");
            var d = tryConsume("PATTERN");
            if (s || d) {
              var g = v || "";
              if (a.indexOf(g) === -1) {
                p += g;
                g = "";
              }
              if (p) {
                c.push(p);
                p = "";
              }
              c.push({ name: s || f++, prefix: g, suffix: "", pattern: d || safePattern(g), modifier: tryConsume("MODIFIER") || "" });
              continue;
            }
            var x = v || tryConsume("ESCAPED_CHAR");
            if (x) {
              p += x;
              continue;
            }
            if (p) {
              c.push(p);
              p = "";
            }
            var h = tryConsume("OPEN");
            if (h) {
              var g = consumeText();
              var l = tryConsume("NAME") || "";
              var m = tryConsume("PATTERN") || "";
              var T = consumeText();
              mustConsume("CLOSE");
              c.push({ name: l || (m ? f++ : ""), pattern: l && !m ? safePattern(g) : m, prefix: g, suffix: T, modifier: tryConsume("MODIFIER") || "" });
              continue;
            }
            mustConsume("END");
          }
          return c;
        }
        n.parse = parse;
        function compile(e2, n2) {
          return tokensToFunction(parse(e2, n2), n2);
        }
        n.compile = compile;
        function tokensToFunction(e2, n2) {
          if (n2 === void 0) {
            n2 = {};
          }
          var r = flags(n2);
          var t = n2.encode, a = t === void 0 ? function(e3) {
            return e3;
          } : t, i = n2.validate, o = i === void 0 ? true : i;
          var c = e2.map((function(e3) {
            if (typeof e3 === "object") {
              return new RegExp("^(?:".concat(e3.pattern, ")$"), r);
            }
          }));
          return function(n3) {
            var r2 = "";
            for (var t2 = 0; t2 < e2.length; t2++) {
              var i2 = e2[t2];
              if (typeof i2 === "string") {
                r2 += i2;
                continue;
              }
              var f = n3 ? n3[i2.name] : void 0;
              var u = i2.modifier === "?" || i2.modifier === "*";
              var p = i2.modifier === "*" || i2.modifier === "+";
              if (Array.isArray(f)) {
                if (!p) {
                  throw new TypeError('Expected "'.concat(i2.name, '" to not repeat, but got an array'));
                }
                if (f.length === 0) {
                  if (u) continue;
                  throw new TypeError('Expected "'.concat(i2.name, '" to not be empty'));
                }
                for (var v = 0; v < f.length; v++) {
                  var s = a(f[v], i2);
                  if (o && !c[t2].test(s)) {
                    throw new TypeError('Expected all "'.concat(i2.name, '" to match "').concat(i2.pattern, '", but got "').concat(s, '"'));
                  }
                  r2 += i2.prefix + s + i2.suffix;
                }
                continue;
              }
              if (typeof f === "string" || typeof f === "number") {
                var s = a(String(f), i2);
                if (o && !c[t2].test(s)) {
                  throw new TypeError('Expected "'.concat(i2.name, '" to match "').concat(i2.pattern, '", but got "').concat(s, '"'));
                }
                r2 += i2.prefix + s + i2.suffix;
                continue;
              }
              if (u) continue;
              var d = p ? "an array" : "a string";
              throw new TypeError('Expected "'.concat(i2.name, '" to be ').concat(d));
            }
            return r2;
          };
        }
        n.tokensToFunction = tokensToFunction;
        function match(e2, n2) {
          var r = [];
          var t = pathToRegexp(e2, r, n2);
          return regexpToFunction(t, r, n2);
        }
        n.match = match;
        function regexpToFunction(e2, n2, r) {
          if (r === void 0) {
            r = {};
          }
          var t = r.decode, a = t === void 0 ? function(e3) {
            return e3;
          } : t;
          return function(r2) {
            var t2 = e2.exec(r2);
            if (!t2) return false;
            var i = t2[0], o = t2.index;
            var c = /* @__PURE__ */ Object.create(null);
            var _loop_1 = function(e3) {
              if (t2[e3] === void 0) return "continue";
              var r3 = n2[e3 - 1];
              if (r3.modifier === "*" || r3.modifier === "+") {
                c[r3.name] = t2[e3].split(r3.prefix + r3.suffix).map((function(e4) {
                  return a(e4, r3);
                }));
              } else {
                c[r3.name] = a(t2[e3], r3);
              }
            };
            for (var f = 1; f < t2.length; f++) {
              _loop_1(f);
            }
            return { path: i, index: o, params: c };
          };
        }
        n.regexpToFunction = regexpToFunction;
        function escapeString(e2) {
          return e2.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
        }
        function flags(e2) {
          return e2 && e2.sensitive ? "" : "i";
        }
        function regexpToRegexp(e2, n2) {
          if (!n2) return e2;
          var r = /\((?:\?<(.*?)>)?(?!\?)/g;
          var t = 0;
          var a = r.exec(e2.source);
          while (a) {
            n2.push({ name: a[1] || t++, prefix: "", suffix: "", modifier: "", pattern: "" });
            a = r.exec(e2.source);
          }
          return e2;
        }
        function arrayToRegexp(e2, n2, r) {
          var t = e2.map((function(e3) {
            return pathToRegexp(e3, n2, r).source;
          }));
          return new RegExp("(?:".concat(t.join("|"), ")"), flags(r));
        }
        function stringToRegexp(e2, n2, r) {
          return tokensToRegexp(parse(e2, r), n2, r);
        }
        function tokensToRegexp(e2, n2, r) {
          if (r === void 0) {
            r = {};
          }
          var t = r.strict, a = t === void 0 ? false : t, i = r.start, o = i === void 0 ? true : i, c = r.end, f = c === void 0 ? true : c, u = r.encode, p = u === void 0 ? function(e3) {
            return e3;
          } : u, v = r.delimiter, s = v === void 0 ? "/#?" : v, d = r.endsWith, g = d === void 0 ? "" : d;
          var x = "[".concat(escapeString(g), "]|$");
          var h = "[".concat(escapeString(s), "]");
          var l = o ? "^" : "";
          for (var m = 0, T = e2; m < T.length; m++) {
            var E = T[m];
            if (typeof E === "string") {
              l += escapeString(p(E));
            } else {
              var w = escapeString(p(E.prefix));
              var y = escapeString(p(E.suffix));
              if (E.pattern) {
                if (n2) n2.push(E);
                if (w || y) {
                  if (E.modifier === "+" || E.modifier === "*") {
                    var R = E.modifier === "*" ? "?" : "";
                    l += "(?:".concat(w, "((?:").concat(E.pattern, ")(?:").concat(y).concat(w, "(?:").concat(E.pattern, "))*)").concat(y, ")").concat(R);
                  } else {
                    l += "(?:".concat(w, "(").concat(E.pattern, ")").concat(y, ")").concat(E.modifier);
                  }
                } else {
                  if (E.modifier === "+" || E.modifier === "*") {
                    throw new TypeError('Can not repeat "'.concat(E.name, '" without a prefix and suffix'));
                  }
                  l += "(".concat(E.pattern, ")").concat(E.modifier);
                }
              } else {
                l += "(?:".concat(w).concat(y, ")").concat(E.modifier);
              }
            }
          }
          if (f) {
            if (!a) l += "".concat(h, "?");
            l += !r.endsWith ? "$" : "(?=".concat(x, ")");
          } else {
            var A = e2[e2.length - 1];
            var _ = typeof A === "string" ? h.indexOf(A[A.length - 1]) > -1 : A === void 0;
            if (!a) {
              l += "(?:".concat(h, "(?=").concat(x, "))?");
            }
            if (!_) {
              l += "(?=".concat(h, "|").concat(x, ")");
            }
          }
          return new RegExp(l, flags(r));
        }
        n.tokensToRegexp = tokensToRegexp;
        function pathToRegexp(e2, n2, r) {
          if (e2 instanceof RegExp) return regexpToRegexp(e2, n2);
          if (Array.isArray(e2)) return arrayToRegexp(e2, n2, r);
          return stringToRegexp(e2, n2, r);
        }
        n.pathToRegexp = pathToRegexp;
      })();
      module2.exports = e;
    })();
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/lib/route-pattern-normalizer.js
var require_route_pattern_normalizer = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/lib/route-pattern-normalizer.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      PARAM_SEPARATOR: function() {
        return PARAM_SEPARATOR;
      },
      hasAdjacentParameterIssues: function() {
        return hasAdjacentParameterIssues;
      },
      normalizeAdjacentParameters: function() {
        return normalizeAdjacentParameters;
      },
      normalizeTokensForRegexp: function() {
        return normalizeTokensForRegexp;
      },
      stripNormalizedSeparators: function() {
        return stripNormalizedSeparators;
      },
      stripParameterSeparators: function() {
        return stripParameterSeparators;
      }
    });
    var PARAM_SEPARATOR = "_NEXTSEP_";
    function hasAdjacentParameterIssues(route) {
      if (typeof route !== "string") return false;
      if (/\/\(\.{1,3}\):[^/\s]+/.test(route)) {
        return true;
      }
      if (/:[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*/.test(route)) {
        return true;
      }
      return false;
    }
    function normalizeAdjacentParameters(route) {
      let normalized = route;
      normalized = normalized.replace(/(\([^)]*\)):([^/\s]+)/g, `$1${PARAM_SEPARATOR}:$2`);
      normalized = normalized.replace(/:([^:/\s)]+)(?=:)/g, `:$1${PARAM_SEPARATOR}`);
      return normalized;
    }
    function normalizeTokensForRegexp(tokens) {
      return tokens.map((token) => {
        if (typeof token === "object" && token !== null && // Not all token objects have 'modifier' property (e.g., simple text tokens)
        "modifier" in token && // Only repeating modifiers (* or +) cause the validation error
        // Other modifiers like '?' (optional) are fine
        (token.modifier === "*" || token.modifier === "+") && // Token objects can have different shapes depending on route pattern
        "prefix" in token && "suffix" in token && // Both prefix and suffix must be empty strings
        // This is what causes the validation error in path-to-regexp
        token.prefix === "" && token.suffix === "") {
          return {
            ...token,
            prefix: "/"
          };
        }
        return token;
      });
    }
    function stripNormalizedSeparators(pathname) {
      return pathname.replace(new RegExp(`\\)${PARAM_SEPARATOR}`, "g"), ")");
    }
    function stripParameterSeparators(params) {
      const cleaned = {};
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") {
          cleaned[key] = value.replace(new RegExp(`^${PARAM_SEPARATOR}`), "");
        } else if (Array.isArray(value)) {
          cleaned[key] = value.map((item) => typeof item === "string" ? item.replace(new RegExp(`^${PARAM_SEPARATOR}`), "") : item);
        } else {
          cleaned[key] = value;
        }
      }
      return cleaned;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-match-utils.js
var require_route_match_utils = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-match-utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      safeCompile: function() {
        return safeCompile;
      },
      safePathToRegexp: function() {
        return safePathToRegexp;
      },
      safeRegexpToFunction: function() {
        return safeRegexpToFunction;
      },
      safeRouteMatcher: function() {
        return safeRouteMatcher;
      }
    });
    var _pathtoregexp = require_path_to_regexp();
    var _routepatternnormalizer = require_route_pattern_normalizer();
    function safePathToRegexp(route, keys, options) {
      if (typeof route !== "string") {
        return (0, _pathtoregexp.pathToRegexp)(route, keys, options);
      }
      const needsNormalization = (0, _routepatternnormalizer.hasAdjacentParameterIssues)(route);
      const routeToUse = needsNormalization ? (0, _routepatternnormalizer.normalizeAdjacentParameters)(route) : route;
      try {
        return (0, _pathtoregexp.pathToRegexp)(routeToUse, keys, options);
      } catch (error) {
        if (!needsNormalization) {
          try {
            const normalizedRoute = (0, _routepatternnormalizer.normalizeAdjacentParameters)(route);
            return (0, _pathtoregexp.pathToRegexp)(normalizedRoute, keys, options);
          } catch (retryError) {
            throw error;
          }
        }
        throw error;
      }
    }
    function safeCompile(route, options) {
      const needsNormalization = (0, _routepatternnormalizer.hasAdjacentParameterIssues)(route);
      const routeToUse = needsNormalization ? (0, _routepatternnormalizer.normalizeAdjacentParameters)(route) : route;
      try {
        const compiler = (0, _pathtoregexp.compile)(routeToUse, options);
        if (needsNormalization) {
          return (params) => {
            return (0, _routepatternnormalizer.stripNormalizedSeparators)(compiler(params));
          };
        }
        return compiler;
      } catch (error) {
        if (!needsNormalization) {
          try {
            const normalizedRoute = (0, _routepatternnormalizer.normalizeAdjacentParameters)(route);
            const compiler = (0, _pathtoregexp.compile)(normalizedRoute, options);
            return (params) => {
              return (0, _routepatternnormalizer.stripNormalizedSeparators)(compiler(params));
            };
          } catch (retryError) {
            throw error;
          }
        }
        throw error;
      }
    }
    function safeRegexpToFunction(regexp, keys) {
      const originalMatcher = (0, _pathtoregexp.regexpToFunction)(regexp, keys || []);
      return (pathname) => {
        const result = originalMatcher(pathname);
        if (!result) return false;
        return {
          ...result,
          params: (0, _routepatternnormalizer.stripParameterSeparators)(result.params)
        };
      };
    }
    function safeRouteMatcher(matcherFn) {
      return (pathname) => {
        const result = matcherFn(pathname);
        if (!result) return false;
        return (0, _routepatternnormalizer.stripParameterSeparators)(result);
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-matcher.js
var require_route_matcher = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-matcher.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "getRouteMatcher", {
      enumerable: true,
      get: function() {
        return getRouteMatcher;
      }
    });
    var _utils = require_utils();
    var _routematchutils = require_route_match_utils();
    function getRouteMatcher({ re, groups }) {
      const rawMatcher = (pathname) => {
        const routeMatch = re.exec(pathname);
        if (!routeMatch) return false;
        const decode = (param) => {
          try {
            return decodeURIComponent(param);
          } catch {
            throw Object.defineProperty(new _utils.DecodeError("failed to decode param"), "__NEXT_ERROR_CODE", {
              value: "E528",
              enumerable: false,
              configurable: true
            });
          }
        };
        const params = {};
        for (const [key, group] of Object.entries(groups)) {
          const match = routeMatch[group.pos];
          if (match !== void 0) {
            if (group.repeat) {
              params[key] = match.split("/").map((entry) => decode(entry));
            } else {
              params[key] = decode(match);
            }
          }
        }
        return params;
      };
      return (0, _routematchutils.safeRouteMatcher)(rawMatcher);
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/lib/constants.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      ACTION_SUFFIX: function() {
        return ACTION_SUFFIX;
      },
      APP_DIR_ALIAS: function() {
        return APP_DIR_ALIAS;
      },
      CACHE_ONE_YEAR_SECONDS: function() {
        return CACHE_ONE_YEAR_SECONDS;
      },
      DOT_NEXT_ALIAS: function() {
        return DOT_NEXT_ALIAS;
      },
      ESLINT_DEFAULT_DIRS: function() {
        return ESLINT_DEFAULT_DIRS;
      },
      GSP_NO_RETURNED_VALUE: function() {
        return GSP_NO_RETURNED_VALUE;
      },
      GSSP_COMPONENT_MEMBER_ERROR: function() {
        return GSSP_COMPONENT_MEMBER_ERROR;
      },
      GSSP_NO_RETURNED_VALUE: function() {
        return GSSP_NO_RETURNED_VALUE;
      },
      HTML_CONTENT_TYPE_HEADER: function() {
        return HTML_CONTENT_TYPE_HEADER;
      },
      INFINITE_CACHE: function() {
        return INFINITE_CACHE;
      },
      INSTRUMENTATION_HOOK_FILENAME: function() {
        return INSTRUMENTATION_HOOK_FILENAME;
      },
      JSON_CONTENT_TYPE_HEADER: function() {
        return JSON_CONTENT_TYPE_HEADER;
      },
      MATCHED_PATH_HEADER: function() {
        return MATCHED_PATH_HEADER;
      },
      MIDDLEWARE_FILENAME: function() {
        return MIDDLEWARE_FILENAME;
      },
      MIDDLEWARE_LOCATION_REGEXP: function() {
        return MIDDLEWARE_LOCATION_REGEXP;
      },
      NEXT_BODY_SUFFIX: function() {
        return NEXT_BODY_SUFFIX;
      },
      NEXT_CACHE_IMPLICIT_TAG_ID: function() {
        return NEXT_CACHE_IMPLICIT_TAG_ID;
      },
      NEXT_CACHE_REVALIDATED_TAGS_HEADER: function() {
        return NEXT_CACHE_REVALIDATED_TAGS_HEADER;
      },
      NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER: function() {
        return NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER;
      },
      NEXT_CACHE_ROOT_PARAM_TAG_ID: function() {
        return NEXT_CACHE_ROOT_PARAM_TAG_ID;
      },
      NEXT_CACHE_SOFT_TAG_MAX_LENGTH: function() {
        return NEXT_CACHE_SOFT_TAG_MAX_LENGTH;
      },
      NEXT_CACHE_TAGS_HEADER: function() {
        return NEXT_CACHE_TAGS_HEADER;
      },
      NEXT_CACHE_TAG_MAX_ITEMS: function() {
        return NEXT_CACHE_TAG_MAX_ITEMS;
      },
      NEXT_CACHE_TAG_MAX_LENGTH: function() {
        return NEXT_CACHE_TAG_MAX_LENGTH;
      },
      NEXT_DATA_SUFFIX: function() {
        return NEXT_DATA_SUFFIX;
      },
      NEXT_INTERCEPTION_MARKER_PREFIX: function() {
        return NEXT_INTERCEPTION_MARKER_PREFIX;
      },
      NEXT_META_SUFFIX: function() {
        return NEXT_META_SUFFIX;
      },
      NEXT_NAV_DEPLOYMENT_ID_HEADER: function() {
        return NEXT_NAV_DEPLOYMENT_ID_HEADER;
      },
      NEXT_QUERY_PARAM_PREFIX: function() {
        return NEXT_QUERY_PARAM_PREFIX;
      },
      NEXT_RESUME_HEADER: function() {
        return NEXT_RESUME_HEADER;
      },
      NEXT_RESUME_STATE_LENGTH_HEADER: function() {
        return NEXT_RESUME_STATE_LENGTH_HEADER;
      },
      NON_STANDARD_NODE_ENV: function() {
        return NON_STANDARD_NODE_ENV;
      },
      PAGES_DIR_ALIAS: function() {
        return PAGES_DIR_ALIAS;
      },
      PRERENDER_REVALIDATE_HEADER: function() {
        return PRERENDER_REVALIDATE_HEADER;
      },
      PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER: function() {
        return PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER;
      },
      PROXY_FILENAME: function() {
        return PROXY_FILENAME;
      },
      PROXY_LOCATION_REGEXP: function() {
        return PROXY_LOCATION_REGEXP;
      },
      PUBLIC_DIR_MIDDLEWARE_CONFLICT: function() {
        return PUBLIC_DIR_MIDDLEWARE_CONFLICT;
      },
      ROOT_DIR_ALIAS: function() {
        return ROOT_DIR_ALIAS;
      },
      RSC_ACTION_CLIENT_WRAPPER_ALIAS: function() {
        return RSC_ACTION_CLIENT_WRAPPER_ALIAS;
      },
      RSC_ACTION_ENCRYPTION_ALIAS: function() {
        return RSC_ACTION_ENCRYPTION_ALIAS;
      },
      RSC_ACTION_PROXY_ALIAS: function() {
        return RSC_ACTION_PROXY_ALIAS;
      },
      RSC_ACTION_VALIDATE_ALIAS: function() {
        return RSC_ACTION_VALIDATE_ALIAS;
      },
      RSC_CACHE_WRAPPER_ALIAS: function() {
        return RSC_CACHE_WRAPPER_ALIAS;
      },
      RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS: function() {
        return RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS;
      },
      RSC_MOD_REF_PROXY_ALIAS: function() {
        return RSC_MOD_REF_PROXY_ALIAS;
      },
      RSC_SEGMENTS_DIR_SUFFIX: function() {
        return RSC_SEGMENTS_DIR_SUFFIX;
      },
      RSC_SEGMENT_SUFFIX: function() {
        return RSC_SEGMENT_SUFFIX;
      },
      RSC_SUFFIX: function() {
        return RSC_SUFFIX;
      },
      SERVER_PROPS_EXPORT_ERROR: function() {
        return SERVER_PROPS_EXPORT_ERROR;
      },
      SERVER_PROPS_GET_INIT_PROPS_CONFLICT: function() {
        return SERVER_PROPS_GET_INIT_PROPS_CONFLICT;
      },
      SERVER_PROPS_SSG_CONFLICT: function() {
        return SERVER_PROPS_SSG_CONFLICT;
      },
      SERVER_RUNTIME: function() {
        return SERVER_RUNTIME;
      },
      SSG_FALLBACK_EXPORT_ERROR: function() {
        return SSG_FALLBACK_EXPORT_ERROR;
      },
      SSG_GET_INITIAL_PROPS_CONFLICT: function() {
        return SSG_GET_INITIAL_PROPS_CONFLICT;
      },
      STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR: function() {
        return STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR;
      },
      TEXT_PLAIN_CONTENT_TYPE_HEADER: function() {
        return TEXT_PLAIN_CONTENT_TYPE_HEADER;
      },
      UNSTABLE_REVALIDATE_RENAME_ERROR: function() {
        return UNSTABLE_REVALIDATE_RENAME_ERROR;
      },
      WEBPACK_LAYERS: function() {
        return WEBPACK_LAYERS;
      },
      WEBPACK_RESOURCE_QUERIES: function() {
        return WEBPACK_RESOURCE_QUERIES;
      },
      WEB_SOCKET_MAX_RECONNECTIONS: function() {
        return WEB_SOCKET_MAX_RECONNECTIONS;
      }
    });
    var TEXT_PLAIN_CONTENT_TYPE_HEADER = "text/plain";
    var HTML_CONTENT_TYPE_HEADER = "text/html; charset=utf-8";
    var JSON_CONTENT_TYPE_HEADER = "application/json; charset=utf-8";
    var NEXT_QUERY_PARAM_PREFIX = "nxtP";
    var NEXT_INTERCEPTION_MARKER_PREFIX = "nxtI";
    var MATCHED_PATH_HEADER = "x-matched-path";
    var PRERENDER_REVALIDATE_HEADER = "x-prerender-revalidate";
    var PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER = "x-prerender-revalidate-if-generated";
    var RSC_SEGMENTS_DIR_SUFFIX = ".segments";
    var RSC_SEGMENT_SUFFIX = ".segment.rsc";
    var RSC_SUFFIX = ".rsc";
    var ACTION_SUFFIX = ".action";
    var NEXT_DATA_SUFFIX = ".json";
    var NEXT_META_SUFFIX = ".meta";
    var NEXT_BODY_SUFFIX = ".body";
    var NEXT_NAV_DEPLOYMENT_ID_HEADER = "x-nextjs-deployment-id";
    var NEXT_CACHE_TAGS_HEADER = "x-next-cache-tags";
    var NEXT_CACHE_REVALIDATED_TAGS_HEADER = "x-next-revalidated-tags";
    var NEXT_CACHE_REVALIDATE_TAG_TOKEN_HEADER = "x-next-revalidate-tag-token";
    var NEXT_RESUME_HEADER = "next-resume";
    var NEXT_RESUME_STATE_LENGTH_HEADER = "x-next-resume-state-length";
    var NEXT_CACHE_TAG_MAX_ITEMS = 128;
    var NEXT_CACHE_TAG_MAX_LENGTH = 256;
    var NEXT_CACHE_SOFT_TAG_MAX_LENGTH = 1024;
    var NEXT_CACHE_IMPLICIT_TAG_ID = "_N_T_";
    var NEXT_CACHE_ROOT_PARAM_TAG_ID = "_N_RP_";
    var CACHE_ONE_YEAR_SECONDS = 31536e3;
    var INFINITE_CACHE = 4294967294;
    var MIDDLEWARE_FILENAME = "middleware";
    var MIDDLEWARE_LOCATION_REGEXP = `(?:src/)?${MIDDLEWARE_FILENAME}`;
    var PROXY_FILENAME = "proxy";
    var PROXY_LOCATION_REGEXP = `(?:src/)?${PROXY_FILENAME}`;
    var INSTRUMENTATION_HOOK_FILENAME = "instrumentation";
    var PAGES_DIR_ALIAS = "private-next-pages";
    var DOT_NEXT_ALIAS = "private-dot-next";
    var ROOT_DIR_ALIAS = "private-next-root-dir";
    var APP_DIR_ALIAS = "private-next-app-dir";
    var RSC_MOD_REF_PROXY_ALIAS = "private-next-rsc-mod-ref-proxy";
    var RSC_ACTION_VALIDATE_ALIAS = "private-next-rsc-action-validate";
    var RSC_ACTION_PROXY_ALIAS = "private-next-rsc-server-reference";
    var RSC_CACHE_WRAPPER_ALIAS = "private-next-rsc-cache-wrapper";
    var RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS = "private-next-rsc-track-dynamic-import";
    var RSC_ACTION_ENCRYPTION_ALIAS = "private-next-rsc-action-encryption";
    var RSC_ACTION_CLIENT_WRAPPER_ALIAS = "private-next-rsc-action-client-wrapper";
    var PUBLIC_DIR_MIDDLEWARE_CONFLICT = `You can not have a '_next' folder inside of your public folder. This conflicts with the internal '/_next' route. https://nextjs.org/docs/messages/public-next-folder-conflict`;
    var SSG_GET_INITIAL_PROPS_CONFLICT = `You can not use getInitialProps with getStaticProps. To use SSG, please remove your getInitialProps`;
    var SERVER_PROPS_GET_INIT_PROPS_CONFLICT = `You can not use getInitialProps with getServerSideProps. Please remove getInitialProps.`;
    var SERVER_PROPS_SSG_CONFLICT = `You can not use getStaticProps or getStaticPaths with getServerSideProps. To use SSG, please remove getServerSideProps`;
    var STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR = `can not have getInitialProps/getServerSideProps, https://nextjs.org/docs/messages/404-get-initial-props`;
    var SERVER_PROPS_EXPORT_ERROR = `pages with \`getServerSideProps\` can not be exported. See more info here: https://nextjs.org/docs/messages/gssp-export`;
    var GSP_NO_RETURNED_VALUE = "Your `getStaticProps` function did not return an object. Did you forget to add a `return`?";
    var GSSP_NO_RETURNED_VALUE = "Your `getServerSideProps` function did not return an object. Did you forget to add a `return`?";
    var UNSTABLE_REVALIDATE_RENAME_ERROR = "The `unstable_revalidate` property is available for general use.\nPlease use `revalidate` instead.";
    var GSSP_COMPONENT_MEMBER_ERROR = `can not be attached to a page's component and must be exported from the page. See more info here: https://nextjs.org/docs/messages/gssp-component-member`;
    var NON_STANDARD_NODE_ENV = `You are using a non-standard "NODE_ENV" value in your environment. This creates inconsistencies in the project and is strongly advised against. Read more: https://nextjs.org/docs/messages/non-standard-node-env`;
    var SSG_FALLBACK_EXPORT_ERROR = `Pages with \`fallback\` enabled in \`getStaticPaths\` can not be exported. See more info here: https://nextjs.org/docs/messages/ssg-fallback-true-export`;
    var ESLINT_DEFAULT_DIRS = [
      "app",
      "pages",
      "components",
      "lib",
      "src"
    ];
    var SERVER_RUNTIME = {
      edge: "edge",
      experimentalEdge: "experimental-edge",
      nodejs: "nodejs"
    };
    var WEB_SOCKET_MAX_RECONNECTIONS = 12;
    var WEBPACK_LAYERS_NAMES = {
      /**
      * The layer for the shared code between the client and server bundles.
      */
      shared: "shared",
      /**
      * The layer for server-only runtime and picking up `react-server` export conditions.
      * Including app router RSC pages and app router custom routes and metadata routes.
      */
      reactServerComponents: "rsc",
      /**
      * Server Side Rendering layer for app (ssr).
      */
      serverSideRendering: "ssr",
      /**
      * The browser client bundle layer for actions.
      */
      actionBrowser: "action-browser",
      /**
      * The Node.js bundle layer for the API routes.
      */
      apiNode: "api-node",
      /**
      * The Edge Lite bundle layer for the API routes.
      */
      apiEdge: "api-edge",
      /**
      * The layer for the middleware code.
      */
      middleware: "middleware",
      /**
      * The layer for the instrumentation hooks.
      */
      instrument: "instrument",
      /**
      * The layer for assets on the edge.
      */
      edgeAsset: "edge-asset",
      /**
      * The browser client bundle layer for App directory.
      */
      appPagesBrowser: "app-pages-browser",
      /**
      * The browser client bundle layer for Pages directory.
      */
      pagesDirBrowser: "pages-dir-browser",
      /**
      * The Edge Lite bundle layer for Pages directory.
      */
      pagesDirEdge: "pages-dir-edge",
      /**
      * The Node.js bundle layer for Pages directory.
      */
      pagesDirNode: "pages-dir-node"
    };
    var WEBPACK_LAYERS = {
      ...WEBPACK_LAYERS_NAMES,
      GROUP: {
        builtinReact: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser
        ],
        serverOnly: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser,
          WEBPACK_LAYERS_NAMES.instrument,
          WEBPACK_LAYERS_NAMES.middleware
        ],
        neutralTarget: [
          // pages api
          WEBPACK_LAYERS_NAMES.apiNode,
          WEBPACK_LAYERS_NAMES.apiEdge
        ],
        clientOnly: [
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser
        ],
        bundled: [
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.actionBrowser,
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser,
          WEBPACK_LAYERS_NAMES.shared,
          WEBPACK_LAYERS_NAMES.instrument,
          WEBPACK_LAYERS_NAMES.middleware
        ],
        appPages: [
          // app router pages and layouts
          WEBPACK_LAYERS_NAMES.reactServerComponents,
          WEBPACK_LAYERS_NAMES.serverSideRendering,
          WEBPACK_LAYERS_NAMES.appPagesBrowser,
          WEBPACK_LAYERS_NAMES.actionBrowser
        ]
      }
    };
    var WEBPACK_RESOURCE_QUERIES = {
      edgeSSREntry: "__next_edge_ssr_entry__",
      metadata: "__next_metadata__",
      metadataRoute: "__next_metadata_route__",
      metadataImageMeta: "__next_metadata_image_meta__"
    };
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/escape-regexp.js
var require_escape_regexp = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/escape-regexp.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "escapeStringRegexp", {
      enumerable: true,
      get: function() {
        return escapeStringRegexp;
      }
    });
    var reHasRegExp = /[|\\{}()[\]^$+*?.-]/;
    var reReplaceRegExp = /[|\\{}()[\]^$+*?.-]/g;
    function escapeStringRegexp(str) {
      if (reHasRegExp.test(str)) {
        return str.replace(reReplaceRegExp, "\\$&");
      }
      return str;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/invariant-error.js
var require_invariant_error = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/invariant-error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "InvariantError", {
      enumerable: true,
      get: function() {
        return InvariantError;
      }
    });
    var InvariantError = class extends Error {
      constructor(message, options) {
        super(`Invariant: ${message.endsWith(".") ? message : message + "."} This is a bug in Next.js.`, options);
        this.name = "InvariantError";
      }
    };
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/parse-loader-tree.js
var require_parse_loader_tree = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/parse-loader-tree.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "parseLoaderTree", {
      enumerable: true,
      get: function() {
        return parseLoaderTree;
      }
    });
    var _segment = require_segment();
    function parseLoaderTree(tree) {
      const [segment, parallelRoutes, modules, staticSiblings] = tree;
      const { layout, template } = modules;
      let { page } = modules;
      page = segment === _segment.DEFAULT_SEGMENT_KEY ? modules.defaultPage : page;
      const conventionPath = layout?.[1] || template?.[1] || page?.[1];
      return {
        page,
        segment,
        modules,
        /* it can be either layout / template / page */
        conventionPath,
        parallelRoutes,
        staticSiblings
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/get-segment-param.js
var require_get_segment_param = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/get-segment-param.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      getParamProperties: function() {
        return getParamProperties;
      },
      getSegmentParam: function() {
        return getSegmentParam;
      },
      isCatchAll: function() {
        return isCatchAll;
      }
    });
    var _interceptionroutes = require_interception_routes();
    function getSegmentParam(segment) {
      const interceptionMarker = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.find((marker) => segment.startsWith(marker));
      if (interceptionMarker) {
        segment = segment.slice(interceptionMarker.length);
      }
      if (segment.startsWith("[[...") && segment.endsWith("]]")) {
        return {
          // TODO-APP: Optional catchall does not currently work with parallel routes,
          // so for now aren't handling a potential interception marker.
          paramType: "optional-catchall",
          paramName: segment.slice(5, -2)
        };
      }
      if (segment.startsWith("[...") && segment.endsWith("]")) {
        return {
          paramType: interceptionMarker ? `catchall-intercepted-${interceptionMarker}` : "catchall",
          paramName: segment.slice(4, -1)
        };
      }
      if (segment.startsWith("[") && segment.endsWith("]")) {
        return {
          paramType: interceptionMarker ? `dynamic-intercepted-${interceptionMarker}` : "dynamic",
          paramName: segment.slice(1, -1)
        };
      }
      return null;
    }
    function isCatchAll(type) {
      return type === "catchall" || type === "catchall-intercepted-(..)(..)" || type === "catchall-intercepted-(.)" || type === "catchall-intercepted-(..)" || type === "catchall-intercepted-(...)" || type === "optional-catchall";
    }
    function getParamProperties(paramType) {
      let repeat = false;
      let optional = false;
      switch (paramType) {
        case "catchall":
        case "catchall-intercepted-(..)(..)":
        case "catchall-intercepted-(.)":
        case "catchall-intercepted-(..)":
        case "catchall-intercepted-(...)":
          repeat = true;
          break;
        case "optional-catchall":
          repeat = true;
          optional = true;
          break;
        case "dynamic":
        case "dynamic-intercepted-(..)(..)":
        case "dynamic-intercepted-(.)":
        case "dynamic-intercepted-(..)":
        case "dynamic-intercepted-(...)":
          break;
        default:
          paramType;
      }
      return {
        repeat,
        optional
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/routes/app.js
var require_app = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/routes/app.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      isInterceptionAppRoute: function() {
        return isInterceptionAppRoute;
      },
      isNormalizedAppRoute: function() {
        return isNormalizedAppRoute;
      },
      parseAppRoute: function() {
        return parseAppRoute;
      },
      parseAppRouteSegment: function() {
        return parseAppRouteSegment;
      }
    });
    var _invarianterror = require_invariant_error();
    var _getsegmentparam = require_get_segment_param();
    var _interceptionroutes = require_interception_routes();
    function normalizeEncodedDynamicPlaceholder(segment) {
      if (!/%5b|%5d/i.test(segment)) {
        return segment;
      }
      try {
        const decodedSegment = decodeURIComponent(segment);
        return (0, _getsegmentparam.getSegmentParam)(decodedSegment) ? decodedSegment : segment;
      } catch {
        return segment;
      }
    }
    function parseAppRouteSegment(segment) {
      if (segment === "") {
        return null;
      }
      const interceptionMarker = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.find((m) => segment.startsWith(m));
      const param = (0, _getsegmentparam.getSegmentParam)(segment);
      if (param) {
        return {
          type: "dynamic",
          name: segment,
          param,
          interceptionMarker
        };
      } else if (segment.startsWith("(") && segment.endsWith(")")) {
        return {
          type: "route-group",
          name: segment,
          interceptionMarker
        };
      } else if (segment.startsWith("@")) {
        return {
          type: "parallel-route",
          name: segment,
          interceptionMarker
        };
      } else {
        return {
          type: "static",
          name: segment,
          interceptionMarker
        };
      }
    }
    function isNormalizedAppRoute(route) {
      return route.normalized;
    }
    function isInterceptionAppRoute(route) {
      return route.interceptionMarker !== void 0 && route.interceptingRoute !== void 0 && route.interceptedRoute !== void 0;
    }
    function parseAppRoute(pathname, normalized) {
      const pathnameSegments = pathname.split("/").filter(Boolean);
      const segments = [];
      let interceptionMarker;
      let interceptingRoute;
      let interceptedRoute;
      for (const segment of pathnameSegments) {
        const normalizedSegment = normalizeEncodedDynamicPlaceholder(segment);
        const appSegment = parseAppRouteSegment(normalizedSegment);
        if (!appSegment) {
          continue;
        }
        if (normalized && (appSegment.type === "route-group" || appSegment.type === "parallel-route")) {
          throw Object.defineProperty(new _invarianterror.InvariantError(`${pathname} is being parsed as a normalized route, but it has a route group or parallel route segment.`), "__NEXT_ERROR_CODE", {
            value: "E923",
            enumerable: false,
            configurable: true
          });
        }
        segments.push(appSegment);
        if (appSegment.interceptionMarker) {
          const parts = pathname.split(appSegment.interceptionMarker);
          if (parts.length !== 2) {
            throw Object.defineProperty(new Error(`Invalid interception route: ${pathname}`), "__NEXT_ERROR_CODE", {
              value: "E924",
              enumerable: false,
              configurable: true
            });
          }
          interceptingRoute = normalized ? parseAppRoute(parts[0], true) : parseAppRoute(parts[0], false);
          interceptedRoute = normalized ? parseAppRoute(parts[1], true) : parseAppRoute(parts[1], false);
          interceptionMarker = appSegment.interceptionMarker;
        }
      }
      const dynamicSegments = segments.filter((segment) => segment.type === "dynamic");
      return {
        normalized,
        pathname,
        segments,
        dynamicSegments,
        interceptionMarker,
        interceptingRoute,
        interceptedRoute
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interception-prefix-from-param-type.js
var require_interception_prefix_from_param_type = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interception-prefix-from-param-type.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "interceptionPrefixFromParamType", {
      enumerable: true,
      get: function() {
        return interceptionPrefixFromParamType;
      }
    });
    function interceptionPrefixFromParamType(paramType) {
      switch (paramType) {
        case "catchall-intercepted-(..)(..)":
        case "dynamic-intercepted-(..)(..)":
          return "(..)(..)";
        case "catchall-intercepted-(.)":
        case "dynamic-intercepted-(.)":
          return "(.)";
        case "catchall-intercepted-(..)":
        case "dynamic-intercepted-(..)":
          return "(..)";
        case "catchall-intercepted-(...)":
        case "dynamic-intercepted-(...)":
          return "(...)";
        case "catchall":
        case "dynamic":
        case "optional-catchall":
        default:
          return null;
      }
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/resolve-param-value.js
var require_resolve_param_value = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/resolve-param-value.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "resolveParamValue", {
      enumerable: true,
      get: function() {
        return resolveParamValue;
      }
    });
    var _invarianterror = require_invariant_error();
    var _interceptionprefixfromparamtype = require_interception_prefix_from_param_type();
    function getParamValueFromSegment(pathSegment, params, paramType) {
      if (pathSegment.type === "dynamic") {
        return params[pathSegment.param.paramName];
      }
      const interceptionPrefix = (0, _interceptionprefixfromparamtype.interceptionPrefixFromParamType)(paramType);
      if (interceptionPrefix === pathSegment.interceptionMarker) {
        return pathSegment.name.replace(pathSegment.interceptionMarker, "");
      }
      return pathSegment.name;
    }
    function resolveParamValue(paramName, paramType, depth, route, params) {
      switch (paramType) {
        case "catchall":
        case "optional-catchall":
        case "catchall-intercepted-(..)(..)":
        case "catchall-intercepted-(.)":
        case "catchall-intercepted-(..)":
        case "catchall-intercepted-(...)":
          const processedSegments = [];
          for (let index = depth; index < route.segments.length; index++) {
            const pathSegment = route.segments[index];
            if (pathSegment.type === "static") {
              let value = pathSegment.name;
              const interceptionPrefix = (0, _interceptionprefixfromparamtype.interceptionPrefixFromParamType)(paramType);
              if (interceptionPrefix && index === depth && interceptionPrefix === pathSegment.interceptionMarker) {
                value = value.replace(pathSegment.interceptionMarker, "");
              }
              processedSegments.push(value);
            } else {
              if (!params.hasOwnProperty(pathSegment.param.paramName)) {
                if (pathSegment.param.paramType === "optional-catchall") {
                  break;
                }
                return void 0;
              }
              const paramValue = params[pathSegment.param.paramName];
              if (Array.isArray(paramValue)) {
                processedSegments.push(...paramValue);
              } else {
                processedSegments.push(paramValue);
              }
            }
          }
          if (processedSegments.length > 0) {
            return processedSegments;
          } else if (paramType === "optional-catchall") {
            return void 0;
          } else {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Unexpected empty path segments match for a route "${route.pathname}" with param "${paramName}" of type "${paramType}"`), "__NEXT_ERROR_CODE", {
              value: "E931",
              enumerable: false,
              configurable: true
            });
          }
        case "dynamic":
        case "dynamic-intercepted-(..)(..)":
        case "dynamic-intercepted-(.)":
        case "dynamic-intercepted-(..)":
        case "dynamic-intercepted-(...)":
          if (depth < route.segments.length) {
            const pathSegment = route.segments[depth];
            if (pathSegment.type === "dynamic" && !params.hasOwnProperty(pathSegment.param.paramName)) {
              return void 0;
            }
            return getParamValueFromSegment(pathSegment, params, paramType);
          }
          return void 0;
        default:
          paramType;
      }
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/get-dynamic-param.js
var require_get_dynamic_param = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/get-dynamic-param.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      PARAMETER_PATTERN: function() {
        return PARAMETER_PATTERN;
      },
      getDynamicParam: function() {
        return getDynamicParam;
      },
      interpolateParallelRouteParams: function() {
        return interpolateParallelRouteParams;
      },
      parseMatchedParameter: function() {
        return parseMatchedParameter;
      },
      parseParameter: function() {
        return parseParameter;
      }
    });
    var _invarianterror = require_invariant_error();
    var _parseloadertree = require_parse_loader_tree();
    var _app = require_app();
    var _resolveparamvalue = require_resolve_param_value();
    function getParamValue(interpolatedParams, segmentKey, fallbackRouteParams) {
      let value = interpolatedParams[segmentKey];
      if (fallbackRouteParams?.has(segmentKey)) {
        const [searchValue] = fallbackRouteParams.get(segmentKey);
        value = searchValue;
      } else if (Array.isArray(value)) {
        value = value.map((i) => encodeURIComponent(i));
      } else if (typeof value === "string") {
        value = encodeURIComponent(value);
      }
      return value;
    }
    function interpolateParallelRouteParams(loaderTree, params, pagePath, fallbackRouteParams) {
      const interpolated = structuredClone(params);
      const stack = [
        {
          tree: loaderTree,
          depth: 0
        }
      ];
      const route = (0, _app.parseAppRoute)(pagePath, true);
      while (stack.length > 0) {
        const { tree, depth } = stack.pop();
        const { segment, parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
        const appSegment = (0, _app.parseAppRouteSegment)(segment);
        if (appSegment?.type === "dynamic" && !interpolated.hasOwnProperty(appSegment.param.paramName) && // If the param is in the fallback route params, we don't need to
        // interpolate it because it's already marked as being unknown.
        !fallbackRouteParams?.has(appSegment.param.paramName)) {
          const { paramName, paramType } = appSegment.param;
          const paramValue = (0, _resolveparamvalue.resolveParamValue)(paramName, paramType, depth, route, interpolated);
          if (paramValue !== void 0) {
            interpolated[paramName] = paramValue;
          } else if (paramType !== "optional-catchall") {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Could not resolve param value for segment: ${paramName}`), "__NEXT_ERROR_CODE", {
              value: "E932",
              enumerable: false,
              configurable: true
            });
          }
        }
        let nextDepth = depth;
        if (appSegment && appSegment.type !== "route-group" && appSegment.type !== "parallel-route") {
          nextDepth++;
        }
        for (const parallelRoute of Object.values(parallelRoutes)) {
          stack.push({
            tree: parallelRoute,
            depth: nextDepth
          });
        }
      }
      return interpolated;
    }
    function getDynamicParam(interpolatedParams, segmentKey, dynamicParamType, fallbackRouteParams, staticSiblings) {
      let value = getParamValue(interpolatedParams, segmentKey, fallbackRouteParams);
      if (!value || value.length === 0) {
        if (dynamicParamType === "oc") {
          return {
            param: segmentKey,
            value: null,
            type: dynamicParamType,
            treeSegment: [
              segmentKey,
              "",
              dynamicParamType,
              staticSiblings
            ]
          };
        }
        throw Object.defineProperty(new _invarianterror.InvariantError(`Missing value for segment key: "${segmentKey}" with dynamic param type: ${dynamicParamType}`), "__NEXT_ERROR_CODE", {
          value: "E864",
          enumerable: false,
          configurable: true
        });
      }
      const paramCacheKey = Array.isArray(value) ? value.join("/") : value;
      return {
        param: segmentKey,
        // The value that is passed to user code.
        value,
        // The value that is rendered in the router tree.
        // TODO: If the number of static siblings exceeds some threshold (e.g.,
        // dozens or hundreds), consider sending a Bloom filter instead of the full
        // array to reduce payload size. The client would then use the Bloom filter
        // to check membership with a small false positive rate.
        treeSegment: [
          segmentKey,
          paramCacheKey,
          dynamicParamType,
          staticSiblings
        ],
        type: dynamicParamType
      };
    }
    var PARAMETER_PATTERN = /^([^[]*)\[((?:\[[^\]]*\])|[^\]]+)\](.*)$/;
    function parseParameter(param) {
      const match = param.match(PARAMETER_PATTERN);
      if (!match) {
        return parseMatchedParameter(param);
      }
      return parseMatchedParameter(match[2]);
    }
    function parseMatchedParameter(param) {
      const optional = param.startsWith("[") && param.endsWith("]");
      if (optional) {
        param = param.slice(1, -1);
      }
      const repeat = param.startsWith("...");
      if (repeat) {
        param = param.slice(3);
      }
      return {
        key: param,
        repeat,
        optional
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-regex.js
var require_route_regex = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/route-regex.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      getNamedMiddlewareRegex: function() {
        return getNamedMiddlewareRegex;
      },
      getNamedRouteRegex: function() {
        return getNamedRouteRegex;
      },
      getRouteRegex: function() {
        return getRouteRegex;
      }
    });
    var _constants = require_constants();
    var _interceptionroutes = require_interception_routes();
    var _escaperegexp = require_escape_regexp();
    var _removetrailingslash = require_remove_trailing_slash();
    var _getdynamicparam = require_get_dynamic_param();
    function getParametrizedRoute(route, includeSuffix, includePrefix) {
      const groups = {};
      let groupIndex = 1;
      const segments = [];
      for (const segment of (0, _removetrailingslash.removeTrailingSlash)(route).slice(1).split("/")) {
        const markerMatch = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.find((m) => segment.startsWith(m));
        const paramMatches = segment.match(_getdynamicparam.PARAMETER_PATTERN);
        if (markerMatch && paramMatches && paramMatches[2]) {
          const { key, optional, repeat } = (0, _getdynamicparam.parseMatchedParameter)(paramMatches[2]);
          groups[key] = {
            pos: groupIndex++,
            repeat,
            optional
          };
          segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(markerMatch)}([^/]+?)`);
        } else if (paramMatches && paramMatches[2]) {
          const { key, repeat, optional } = (0, _getdynamicparam.parseMatchedParameter)(paramMatches[2]);
          groups[key] = {
            pos: groupIndex++,
            repeat,
            optional
          };
          if (includePrefix && paramMatches[1]) {
            segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(paramMatches[1])}`);
          }
          let s = repeat ? optional ? "(?:/(.+?))?" : "/(.+?)" : "/([^/]+?)";
          if (includePrefix && paramMatches[1]) {
            s = s.substring(1);
          }
          segments.push(s);
        } else {
          segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(segment)}`);
        }
        if (includeSuffix && paramMatches && paramMatches[3]) {
          segments.push((0, _escaperegexp.escapeStringRegexp)(paramMatches[3]));
        }
      }
      return {
        parameterizedRoute: segments.join(""),
        groups
      };
    }
    function getRouteRegex(normalizedRoute, { includeSuffix = false, includePrefix = false, excludeOptionalTrailingSlash = false } = {}) {
      const { parameterizedRoute, groups } = getParametrizedRoute(normalizedRoute, includeSuffix, includePrefix);
      let re = parameterizedRoute;
      if (!excludeOptionalTrailingSlash) {
        re += "(?:/)?";
      }
      return {
        re: new RegExp(`^${re}$`),
        groups
      };
    }
    function buildGetSafeRouteKey() {
      let i = 0;
      return () => {
        let routeKey = "";
        let j = ++i;
        while (j > 0) {
          routeKey += String.fromCharCode(97 + (j - 1) % 26);
          j = Math.floor((j - 1) / 26);
        }
        return routeKey;
      };
    }
    function getSafeKeyFromSegment({ interceptionMarker, getSafeRouteKey, segment, routeKeys, keyPrefix, backreferenceDuplicateKeys }) {
      const { key, optional, repeat } = (0, _getdynamicparam.parseMatchedParameter)(segment);
      let cleanedKey = key.replace(/\W/g, "");
      if (keyPrefix) {
        cleanedKey = `${keyPrefix}${cleanedKey}`;
      }
      let invalidKey = false;
      if (cleanedKey.length === 0 || cleanedKey.length > 30) {
        invalidKey = true;
      }
      if (!isNaN(parseInt(cleanedKey.slice(0, 1)))) {
        invalidKey = true;
      }
      if (invalidKey) {
        cleanedKey = getSafeRouteKey();
      }
      const duplicateKey = cleanedKey in routeKeys;
      if (keyPrefix) {
        routeKeys[cleanedKey] = `${keyPrefix}${key}`;
      } else {
        routeKeys[cleanedKey] = key;
      }
      const interceptionPrefix = interceptionMarker ? (0, _escaperegexp.escapeStringRegexp)(interceptionMarker) : "";
      let pattern;
      if (duplicateKey && backreferenceDuplicateKeys) {
        pattern = `\\k<${cleanedKey}>`;
      } else if (repeat) {
        pattern = `(?<${cleanedKey}>.+?)`;
      } else {
        pattern = `(?<${cleanedKey}>[^/]+?)`;
      }
      return {
        key,
        pattern: optional ? `(?:/${interceptionPrefix}${pattern})?` : `/${interceptionPrefix}${pattern}`,
        cleanedKey,
        optional,
        repeat
      };
    }
    function getNamedParametrizedRoute(route, prefixRouteKeys, includeSuffix, includePrefix, backreferenceDuplicateKeys, reference = {
      names: {},
      intercepted: {}
    }) {
      const getSafeRouteKey = buildGetSafeRouteKey();
      const routeKeys = {};
      const segments = [];
      const inverseParts = [];
      reference = structuredClone(reference);
      for (const segment of (0, _removetrailingslash.removeTrailingSlash)(route).slice(1).split("/")) {
        const hasInterceptionMarker = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.some((m) => segment.startsWith(m));
        const paramMatches = segment.match(_getdynamicparam.PARAMETER_PATTERN);
        const interceptionMarker = hasInterceptionMarker ? paramMatches?.[1] : void 0;
        let keyPrefix;
        if (interceptionMarker && paramMatches?.[2]) {
          keyPrefix = prefixRouteKeys ? _constants.NEXT_INTERCEPTION_MARKER_PREFIX : void 0;
          reference.intercepted[paramMatches[2]] = interceptionMarker;
        } else if (paramMatches?.[2] && reference.intercepted[paramMatches[2]]) {
          keyPrefix = prefixRouteKeys ? _constants.NEXT_INTERCEPTION_MARKER_PREFIX : void 0;
        } else {
          keyPrefix = prefixRouteKeys ? _constants.NEXT_QUERY_PARAM_PREFIX : void 0;
        }
        if (interceptionMarker && paramMatches && paramMatches[2]) {
          const { key, pattern, cleanedKey, repeat, optional } = getSafeKeyFromSegment({
            getSafeRouteKey,
            interceptionMarker,
            segment: paramMatches[2],
            routeKeys,
            keyPrefix,
            backreferenceDuplicateKeys
          });
          segments.push(pattern);
          inverseParts.push(`/${paramMatches[1]}:${reference.names[key] ?? cleanedKey}${repeat ? optional ? "*" : "+" : ""}`);
          reference.names[key] ??= cleanedKey;
        } else if (paramMatches && paramMatches[2]) {
          if (includePrefix && paramMatches[1]) {
            segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(paramMatches[1])}`);
            inverseParts.push(`/${paramMatches[1]}`);
          }
          const { key, pattern, cleanedKey, repeat, optional } = getSafeKeyFromSegment({
            getSafeRouteKey,
            segment: paramMatches[2],
            routeKeys,
            keyPrefix,
            backreferenceDuplicateKeys
          });
          let s = pattern;
          if (includePrefix && paramMatches[1]) {
            s = s.substring(1);
          }
          segments.push(s);
          inverseParts.push(`/:${reference.names[key] ?? cleanedKey}${repeat ? optional ? "*" : "+" : ""}`);
          reference.names[key] ??= cleanedKey;
        } else {
          segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(segment)}`);
          inverseParts.push(`/${segment}`);
        }
        if (includeSuffix && paramMatches && paramMatches[3]) {
          segments.push((0, _escaperegexp.escapeStringRegexp)(paramMatches[3]));
          inverseParts.push(paramMatches[3]);
        }
      }
      return {
        namedParameterizedRoute: segments.join(""),
        routeKeys,
        pathToRegexpPattern: inverseParts.join(""),
        reference
      };
    }
    function getNamedRouteRegex(normalizedRoute, options) {
      const result = getNamedParametrizedRoute(normalizedRoute, options.prefixRouteKeys, options.includeSuffix ?? false, options.includePrefix ?? false, options.backreferenceDuplicateKeys ?? false, options.reference);
      let namedRegex = result.namedParameterizedRoute;
      if (!options.excludeOptionalTrailingSlash) {
        namedRegex += "(?:/)?";
      }
      return {
        ...getRouteRegex(normalizedRoute, options),
        namedRegex: `^${namedRegex}$`,
        routeKeys: result.routeKeys,
        pathToRegexpPattern: result.pathToRegexpPattern,
        reference: result.reference
      };
    }
    function getNamedMiddlewareRegex(normalizedRoute, options) {
      const { parameterizedRoute } = getParametrizedRoute(normalizedRoute, false, false);
      const { catchAll = true } = options;
      if (parameterizedRoute === "/") {
        let catchAllRegex = catchAll ? ".*" : "";
        return {
          namedRegex: `^/${catchAllRegex}$`
        };
      }
      const { namedParameterizedRoute } = getNamedParametrizedRoute(normalizedRoute, false, false, false, false, void 0);
      let catchAllGroupedRegex = catchAll ? "(?:(/.*)?)" : "";
      return {
        namedRegex: `^${namedParameterizedRoute}${catchAllGroupedRegex}$`
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interpolate-as.js
var require_interpolate_as = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/interpolate-as.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "interpolateAs", {
      enumerable: true,
      get: function() {
        return interpolateAs;
      }
    });
    var _routematcher = require_route_matcher();
    var _routeregex = require_route_regex();
    function interpolateAs(route, asPathname, query) {
      let interpolatedRoute = "";
      const dynamicRegex = (0, _routeregex.getRouteRegex)(route);
      const dynamicGroups = dynamicRegex.groups;
      const dynamicMatches = (
        // Try to match the dynamic route against the asPath
        (asPathname !== route ? (0, _routematcher.getRouteMatcher)(dynamicRegex)(asPathname) : "") || // Fall back to reading the values from the href
        // TODO: should this take priority; also need to change in the router.
        query
      );
      interpolatedRoute = route;
      const params = Object.keys(dynamicGroups);
      if (!params.every((param) => {
        let value = dynamicMatches[param] || "";
        const { repeat, optional } = dynamicGroups[param];
        let replaced = `[${repeat ? "..." : ""}${param}]`;
        if (optional) {
          replaced = `${!value ? "/" : ""}[${replaced}]`;
        }
        if (repeat && !Array.isArray(value)) value = [
          value
        ];
        return (optional || param in dynamicMatches) && // Interpolate group into data URL if present
        (interpolatedRoute = interpolatedRoute.replace(replaced, repeat ? value.map(
          // these values should be fully encoded instead of just
          // path delimiter escaped since they are being inserted
          // into the URL and we expect URL encoded segments
          // when parsing dynamic route params
          (segment) => encodeURIComponent(segment)
        ).join("/") : encodeURIComponent(value)) || "/");
      })) {
        interpolatedRoute = "";
      }
      return {
        params,
        result: interpolatedRoute
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/resolve-href.js
var require_resolve_href = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/resolve-href.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "resolveHref", {
      enumerable: true,
      get: function() {
        return resolveHref;
      }
    });
    var _querystring = require_querystring();
    var _formaturl = require_format_url();
    var _omit = require_omit();
    var _utils = require_utils();
    var _normalizetrailingslash = require_normalize_trailing_slash();
    var _islocalurl = require_is_local_url();
    var _utils1 = require_utils2();
    var _interpolateas = require_interpolate_as();
    var _routeregex = require_route_regex();
    var _routematcher = require_route_matcher();
    function resolveHref(router, href, resolveAs) {
      let base;
      let urlAsString = typeof href === "string" ? href : (0, _formaturl.formatWithValidation)(href);
      const urlProtoMatch = urlAsString.match(/^[a-z][a-z0-9+.-]*:\/\//i);
      const urlAsStringNoProto = urlProtoMatch ? urlAsString.slice(urlProtoMatch[0].length) : urlAsString;
      const urlParts = urlAsStringNoProto.split("?", 1);
      if ((urlParts[0] || "").match(/(\/\/|\\)/)) {
        console.error(`Invalid href '${urlAsString}' passed to next/router in page: '${router.pathname}'. Repeated forward-slashes (//) or backslashes \\ are not valid in the href.`);
        const normalizedUrl = (0, _utils.normalizeRepeatedSlashes)(urlAsStringNoProto);
        urlAsString = (urlProtoMatch ? urlProtoMatch[0] : "") + normalizedUrl;
      }
      if (!(0, _islocalurl.isLocalURL)(urlAsString)) {
        return resolveAs ? [
          urlAsString
        ] : urlAsString;
      }
      try {
        let baseBase = urlAsString.startsWith("#") ? router.asPath : router.pathname;
        if (urlAsString.startsWith("?")) {
          baseBase = router.asPath;
          if ((0, _utils1.isDynamicRoute)(router.pathname)) {
            baseBase = router.pathname;
            const routeRegex = (0, _routeregex.getRouteRegex)(router.pathname);
            const match = (0, _routematcher.getRouteMatcher)(routeRegex)(router.asPath);
            if (!match) {
              baseBase = router.asPath;
            }
          }
        }
        base = new URL(baseBase, "http://n");
      } catch (_) {
        base = new URL("/", "http://n");
      }
      try {
        const finalUrl = new URL(urlAsString, base);
        finalUrl.pathname = (0, _normalizetrailingslash.normalizePathTrailingSlash)(finalUrl.pathname);
        let interpolatedAs = "";
        if ((0, _utils1.isDynamicRoute)(finalUrl.pathname) && finalUrl.searchParams && resolveAs) {
          const query = (0, _querystring.searchParamsToUrlQuery)(finalUrl.searchParams);
          const { result, params } = (0, _interpolateas.interpolateAs)(finalUrl.pathname, finalUrl.pathname, query);
          if (result) {
            interpolatedAs = (0, _formaturl.formatWithValidation)({
              pathname: result,
              hash: finalUrl.hash,
              query: (0, _omit.omit)(query, params)
            });
          }
        }
        const resolvedHref = finalUrl.origin === base.origin ? finalUrl.href.slice(finalUrl.origin.length) : finalUrl.href;
        return resolveAs ? [
          resolvedHref,
          interpolatedAs || resolvedHref
        ] : resolvedHref;
      } catch (_) {
        return resolveAs ? [
          urlAsString
        ] : urlAsString;
      }
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/add-path-prefix.js
var require_add_path_prefix = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/add-path-prefix.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addPathPrefix", {
      enumerable: true,
      get: function() {
        return addPathPrefix;
      }
    });
    var _parsepath = require_parse_path();
    function addPathPrefix(path, prefix) {
      if (!path.startsWith("/") || !prefix) {
        return path;
      }
      const { pathname, query, hash } = (0, _parsepath.parsePath)(path);
      return `${prefix}${pathname}${query}${hash}`;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/add-locale.js
var require_add_locale = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router/utils/add-locale.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addLocale", {
      enumerable: true,
      get: function() {
        return addLocale;
      }
    });
    var _addpathprefix = require_add_path_prefix();
    var _pathhasprefix = require_path_has_prefix();
    function addLocale(path, locale, defaultLocale, ignorePrefix) {
      if (!locale || locale === defaultLocale) return path;
      const lower = path.toLowerCase();
      if (!ignorePrefix) {
        if ((0, _pathhasprefix.pathHasPrefix)(lower, "/api")) return path;
        if ((0, _pathhasprefix.pathHasPrefix)(lower, `/${locale.toLowerCase()}`)) return path;
      }
      return (0, _addpathprefix.addPathPrefix)(path, `/${locale}`);
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/add-locale.js
var require_add_locale2 = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/add-locale.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addLocale", {
      enumerable: true,
      get: function() {
        return addLocale;
      }
    });
    var _normalizetrailingslash = require_normalize_trailing_slash();
    var addLocale = (path, ...args) => {
      if (process.env.__NEXT_I18N_SUPPORT) {
        return (0, _normalizetrailingslash.normalizePathTrailingSlash)(require_add_locale().addLocale(path, ...args));
      }
      return path;
    };
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/cjs/_interop_require_default.cjs
var require_interop_require_default = __commonJS({
  "../../node_modules/.pnpm/@swc+helpers@0.5.15/node_modules/@swc/helpers/cjs/_interop_require_default.cjs"(exports2) {
    "use strict";
    function _interop_require_default(obj) {
      return obj && obj.__esModule ? obj : { default: obj };
    }
    exports2._ = _interop_require_default;
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router-context.shared-runtime.js
var require_router_context_shared_runtime = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/router-context.shared-runtime.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "RouterContext", {
      enumerable: true,
      get: function() {
        return RouterContext;
      }
    });
    var _interop_require_default = require_interop_require_default();
    var _react = /* @__PURE__ */ _interop_require_default._(require("react"));
    var RouterContext = _react.default.createContext(null);
    if (process.env.NODE_ENV !== "production") {
      RouterContext.displayName = "RouterContext";
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/request-idle-callback.js
var require_request_idle_callback = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/request-idle-callback.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      cancelIdleCallback: function() {
        return cancelIdleCallback;
      },
      requestIdleCallback: function() {
        return requestIdleCallback;
      }
    });
    var requestIdleCallback = typeof self !== "undefined" && self.requestIdleCallback && self.requestIdleCallback.bind(window) || function(cb) {
      let start = Date.now();
      return self.setTimeout(function() {
        cb({
          didTimeout: false,
          timeRemaining: function() {
            return Math.max(0, 50 - (Date.now() - start));
          }
        });
      }, 1);
    };
    var cancelIdleCallback = typeof self !== "undefined" && self.cancelIdleCallback && self.cancelIdleCallback.bind(window) || function(id) {
      return clearTimeout(id);
    };
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/use-intersection.js
var require_use_intersection = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/use-intersection.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "useIntersection", {
      enumerable: true,
      get: function() {
        return useIntersection;
      }
    });
    var _react = require("react");
    var _requestidlecallback = require_request_idle_callback();
    var hasIntersectionObserver = typeof IntersectionObserver === "function";
    var observers = /* @__PURE__ */ new Map();
    var idList = [];
    function createObserver(options) {
      const id = {
        root: options.root || null,
        margin: options.rootMargin || ""
      };
      const existing = idList.find((obj) => obj.root === id.root && obj.margin === id.margin);
      let instance;
      if (existing) {
        instance = observers.get(existing);
        if (instance) {
          return instance;
        }
      }
      const elements = /* @__PURE__ */ new Map();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const callback = elements.get(entry.target);
          const isVisible = entry.isIntersecting || entry.intersectionRatio > 0;
          if (callback && isVisible) {
            callback(isVisible);
          }
        });
      }, options);
      instance = {
        id,
        observer,
        elements
      };
      idList.push(id);
      observers.set(id, instance);
      return instance;
    }
    function observe(element, callback, options) {
      const { id, observer, elements } = createObserver(options);
      elements.set(element, callback);
      observer.observe(element);
      return function unobserve() {
        elements.delete(element);
        observer.unobserve(element);
        if (elements.size === 0) {
          observer.disconnect();
          observers.delete(id);
          const index = idList.findIndex((obj) => obj.root === id.root && obj.margin === id.margin);
          if (index > -1) {
            idList.splice(index, 1);
          }
        }
      };
    }
    function useIntersection({ rootRef, rootMargin, disabled }) {
      const isDisabled = disabled || !hasIntersectionObserver;
      const [visible, setVisible] = (0, _react.useState)(false);
      const elementRef = (0, _react.useRef)(null);
      const setElement = (0, _react.useCallback)((element) => {
        elementRef.current = element;
      }, []);
      (0, _react.useEffect)(() => {
        if (hasIntersectionObserver) {
          if (isDisabled || visible) return;
          const element = elementRef.current;
          if (element && element.tagName) {
            const unobserve = observe(element, (isVisible) => isVisible && setVisible(isVisible), {
              root: rootRef?.current,
              rootMargin
            });
            return unobserve;
          }
        } else {
          if (!visible) {
            const idleCallback = (0, _requestidlecallback.requestIdleCallback)(() => setVisible(true));
            return () => (0, _requestidlecallback.cancelIdleCallback)(idleCallback);
          }
        }
      }, [
        isDisabled,
        rootMargin,
        rootRef,
        visible,
        elementRef.current
      ]);
      const resetVisible = (0, _react.useCallback)(() => {
        setVisible(false);
      }, []);
      return [
        setElement,
        visible,
        resetVisible
      ];
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/i18n/normalize-locale-path.js
var require_normalize_locale_path = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/i18n/normalize-locale-path.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "normalizeLocalePath", {
      enumerable: true,
      get: function() {
        return normalizeLocalePath;
      }
    });
    var cache = /* @__PURE__ */ new WeakMap();
    function normalizeLocalePath(pathname, locales) {
      if (!locales) return {
        pathname
      };
      let lowercasedLocales = cache.get(locales);
      if (!lowercasedLocales) {
        lowercasedLocales = locales.map((locale) => locale.toLowerCase());
        cache.set(locales, lowercasedLocales);
      }
      let detectedLocale;
      const segments = pathname.split("/", 2);
      if (!segments[1]) return {
        pathname
      };
      const segment = segments[1].toLowerCase();
      const index = lowercasedLocales.indexOf(segment);
      if (index < 0) return {
        pathname
      };
      detectedLocale = locales[index];
      pathname = pathname.slice(detectedLocale.length + 1) || "/";
      return {
        pathname,
        detectedLocale
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/normalize-locale-path.js
var require_normalize_locale_path2 = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/normalize-locale-path.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "normalizeLocalePath", {
      enumerable: true,
      get: function() {
        return normalizeLocalePath;
      }
    });
    var normalizeLocalePath = (pathname, locales) => {
      if (process.env.__NEXT_I18N_SUPPORT) {
        return require_normalize_locale_path().normalizeLocalePath(pathname, locales);
      }
      return {
        pathname,
        detectedLocale: void 0
      };
    };
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/i18n/detect-domain-locale.js
var require_detect_domain_locale = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/i18n/detect-domain-locale.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "detectDomainLocale", {
      enumerable: true,
      get: function() {
        return detectDomainLocale;
      }
    });
    function detectDomainLocale(domainItems, hostname, detectedLocale) {
      if (!domainItems) return;
      if (detectedLocale) {
        detectedLocale = detectedLocale.toLowerCase();
      }
      for (const item of domainItems) {
        const domainHostname = item.domain?.split(":", 1)[0].toLowerCase();
        if (hostname === domainHostname || detectedLocale === item.defaultLocale.toLowerCase() || item.locales?.some((locale) => locale.toLowerCase() === detectedLocale)) {
          return item;
        }
      }
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/detect-domain-locale.js
var require_detect_domain_locale2 = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/detect-domain-locale.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "detectDomainLocale", {
      enumerable: true,
      get: function() {
        return detectDomainLocale;
      }
    });
    var detectDomainLocale = (...args) => {
      if (process.env.__NEXT_I18N_SUPPORT) {
        return require_detect_domain_locale().detectDomainLocale(...args);
      }
    };
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/get-domain-locale.js
var require_get_domain_locale = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/get-domain-locale.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "getDomainLocale", {
      enumerable: true,
      get: function() {
        return getDomainLocale;
      }
    });
    var _normalizetrailingslash = require_normalize_trailing_slash();
    var basePath = process.env.__NEXT_ROUTER_BASEPATH || "";
    function getDomainLocale(path, locale, locales, domainLocales) {
      if (process.env.__NEXT_I18N_SUPPORT) {
        const normalizeLocalePath = require_normalize_locale_path2().normalizeLocalePath;
        const detectDomainLocale = require_detect_domain_locale2().detectDomainLocale;
        const target = locale || normalizeLocalePath(path, locales).detectedLocale;
        const domain = detectDomainLocale(domainLocales, void 0, target);
        if (domain) {
          const proto = `http${domain.http ? "" : "s"}://`;
          const finalLocale = target === domain.defaultLocale ? "" : `/${target}`;
          return `${proto}${domain.domain}${(0, _normalizetrailingslash.normalizePathTrailingSlash)(`${basePath}${finalLocale}${path}`)}`;
        }
        return false;
      } else {
        return false;
      }
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/add-base-path.js
var require_add_base_path = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/add-base-path.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "addBasePath", {
      enumerable: true,
      get: function() {
        return addBasePath;
      }
    });
    var _addpathprefix = require_add_path_prefix();
    var _normalizetrailingslash = require_normalize_trailing_slash();
    var basePath = process.env.__NEXT_ROUTER_BASEPATH || "";
    function addBasePath(path, required) {
      return (0, _normalizetrailingslash.normalizePathTrailingSlash)(process.env.__NEXT_MANUAL_CLIENT_BASE_PATH && !required ? path : (0, _addpathprefix.addPathPrefix)(path, basePath));
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/use-merged-ref.js
var require_use_merged_ref = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/use-merged-ref.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "useMergedRef", {
      enumerable: true,
      get: function() {
        return useMergedRef;
      }
    });
    var _react = require("react");
    function useMergedRef(refA, refB) {
      const cleanupA = (0, _react.useRef)(null);
      const cleanupB = (0, _react.useRef)(null);
      return (0, _react.useCallback)((current) => {
        if (current === null) {
          const cleanupFnA = cleanupA.current;
          if (cleanupFnA) {
            cleanupA.current = null;
            cleanupFnA();
          }
          const cleanupFnB = cleanupB.current;
          if (cleanupFnB) {
            cleanupB.current = null;
            cleanupFnB();
          }
        } else {
          if (refA) {
            cleanupA.current = applyRef(refA, current);
          }
          if (refB) {
            cleanupB.current = applyRef(refB, current);
          }
        }
      }, [
        refA,
        refB
      ]);
    }
    function applyRef(refA, current) {
      if (typeof refA === "function") {
        const cleanup = refA(current);
        if (typeof cleanup === "function") {
          return cleanup;
        } else {
          return () => refA(null);
        }
      } else {
        refA.current = current;
        return () => {
          refA.current = null;
        };
      }
    }
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/utils/error-once.js
var require_error_once = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/shared/lib/utils/error-once.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "errorOnce", {
      enumerable: true,
      get: function() {
        return errorOnce;
      }
    });
    var errorOnce = (_) => {
    };
    if (process.env.NODE_ENV !== "production") {
      const errors = /* @__PURE__ */ new Set();
      errorOnce = (msg) => {
        if (!errors.has(msg)) {
          console.error(msg);
        }
        errors.add(msg);
      };
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/link.js
var require_link = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/dist/client/link.js"(exports2, module2) {
    "use strict";
    "use client";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    function _export(target, all) {
      for (var name in all) Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
      });
    }
    _export(exports2, {
      default: function() {
        return _default;
      },
      useLinkStatus: function() {
        return useLinkStatus;
      }
    });
    var _interop_require_wildcard = require_interop_require_wildcard();
    var _jsxruntime = require("react/jsx-runtime");
    var _react = /* @__PURE__ */ _interop_require_wildcard._(require("react"));
    var _resolvehref = require_resolve_href();
    var _islocalurl = require_is_local_url();
    var _formaturl = require_format_url();
    var _utils = require_utils();
    var _addlocale = require_add_locale2();
    var _routercontextsharedruntime = require_router_context_shared_runtime();
    var _useintersection = require_use_intersection();
    var _getdomainlocale = require_get_domain_locale();
    var _addbasepath = require_add_base_path();
    var _usemergedref = require_use_merged_ref();
    var _erroronce = require_error_once();
    var prefetched = /* @__PURE__ */ new Set();
    function prefetch(router, href, as, options) {
      if (typeof window === "undefined") {
        return;
      }
      if (!(0, _islocalurl.isLocalURL)(href)) {
        return;
      }
      if (!options.bypassPrefetchedCheck) {
        const locale = (
          // Let the link's locale prop override the default router locale.
          typeof options.locale !== "undefined" ? options.locale : "locale" in router ? router.locale : void 0
        );
        const prefetchedKey = href + "%" + as + "%" + locale;
        if (prefetched.has(prefetchedKey)) {
          return;
        }
        prefetched.add(prefetchedKey);
      }
      router.prefetch(href, as, options).catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          throw err;
        }
      });
    }
    function isModifiedEvent(event) {
      const eventTarget = event.currentTarget;
      const target = eventTarget.getAttribute("target");
      return target && target !== "_self" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || // triggers resource download
      event.nativeEvent && event.nativeEvent.which === 2;
    }
    function linkClicked(e, router, href, as, replace, shallow, scroll, locale, onNavigate) {
      const { nodeName } = e.currentTarget;
      const isAnchorNodeName = nodeName.toUpperCase() === "A";
      if (isAnchorNodeName && isModifiedEvent(e) || e.currentTarget.hasAttribute("download")) {
        return;
      }
      if (!(0, _islocalurl.isLocalURL)(href)) {
        if (replace) {
          e.preventDefault();
          location.replace(href);
        }
        return;
      }
      e.preventDefault();
      const navigate = () => {
        if (onNavigate) {
          let isDefaultPrevented = false;
          onNavigate({
            preventDefault: () => {
              isDefaultPrevented = true;
            }
          });
          if (isDefaultPrevented) {
            return;
          }
        }
        const routerScroll = scroll ?? true;
        if ("beforePopState" in router) {
          router[replace ? "replace" : "push"](href, as, {
            shallow,
            locale,
            scroll: routerScroll
          });
        } else {
          router[replace ? "replace" : "push"](as || href, {
            scroll: routerScroll
          });
        }
      };
      navigate();
    }
    function formatStringOrUrl(urlObjOrString) {
      if (typeof urlObjOrString === "string") {
        return urlObjOrString;
      }
      return (0, _formaturl.formatUrl)(urlObjOrString);
    }
    var Link2 = /* @__PURE__ */ _react.default.forwardRef(function LinkComponent(props, forwardedRef) {
      let children;
      const { href: hrefProp, as: asProp, children: childrenProp, prefetch: prefetchProp = null, passHref, replace, shallow, scroll, locale, onClick, onNavigate, onMouseEnter: onMouseEnterProp, onTouchStart: onTouchStartProp, legacyBehavior = false, transitionTypes, ...restProps } = props;
      children = childrenProp;
      if (legacyBehavior && (typeof children === "string" || typeof children === "number")) {
        children = /* @__PURE__ */ (0, _jsxruntime.jsx)("a", {
          children
        });
      }
      const router = _react.default.useContext(_routercontextsharedruntime.RouterContext);
      const prefetchEnabled = prefetchProp !== false;
      if (process.env.NODE_ENV !== "production") {
        let createPropError = function(args) {
          return Object.defineProperty(new Error(`Failed prop type: The prop \`${args.key}\` expects a ${args.expected} in \`<Link>\`, but got \`${args.actual}\` instead.` + (typeof window !== "undefined" ? "\nOpen your browser's console to view the Component stack trace." : "")), "__NEXT_ERROR_CODE", {
            value: "E319",
            enumerable: false,
            configurable: true
          });
        };
        const requiredPropsGuard = {
          href: true
        };
        const requiredProps = Object.keys(requiredPropsGuard);
        requiredProps.forEach((key) => {
          if (key === "href") {
            if (props[key] == null || typeof props[key] !== "string" && typeof props[key] !== "object") {
              throw createPropError({
                key,
                expected: "`string` or `object`",
                actual: props[key] === null ? "null" : typeof props[key]
              });
            }
          } else {
            const _ = key;
          }
        });
        const optionalPropsGuard = {
          as: true,
          replace: true,
          scroll: true,
          shallow: true,
          passHref: true,
          prefetch: true,
          locale: true,
          onClick: true,
          onMouseEnter: true,
          onTouchStart: true,
          legacyBehavior: true,
          onNavigate: true,
          transitionTypes: true
        };
        const optionalProps = Object.keys(optionalPropsGuard);
        optionalProps.forEach((key) => {
          const valType = typeof props[key];
          if (key === "as") {
            if (props[key] && valType !== "string" && valType !== "object") {
              throw createPropError({
                key,
                expected: "`string` or `object`",
                actual: valType
              });
            }
          } else if (key === "locale") {
            if (props[key] && valType !== "string") {
              throw createPropError({
                key,
                expected: "`string`",
                actual: valType
              });
            }
          } else if (key === "onClick" || key === "onMouseEnter" || key === "onTouchStart" || key === "onNavigate") {
            if (props[key] && valType !== "function") {
              throw createPropError({
                key,
                expected: "`function`",
                actual: valType
              });
            }
          } else if (key === "replace" || key === "scroll" || key === "shallow" || key === "passHref" || key === "legacyBehavior") {
            if (props[key] != null && valType !== "boolean") {
              throw createPropError({
                key,
                expected: "`boolean`",
                actual: valType
              });
            }
          } else if (key === "prefetch") {
            if (props[key] != null && valType !== "boolean" && props[key] !== "auto") {
              throw createPropError({
                key,
                expected: '`boolean | "auto"`',
                actual: valType
              });
            }
          } else if (key === "transitionTypes") {
            if (props[key] != null && !Array.isArray(props[key])) {
              throw createPropError({
                key,
                expected: "`string[]`",
                actual: valType
              });
            }
          } else {
            const _ = key;
          }
        });
      }
      const { href, as } = _react.default.useMemo(() => {
        if (!router) {
          const resolvedHref2 = formatStringOrUrl(hrefProp);
          return {
            href: resolvedHref2,
            as: asProp ? formatStringOrUrl(asProp) : resolvedHref2
          };
        }
        const [resolvedHref, resolvedAs] = (0, _resolvehref.resolveHref)(router, hrefProp, true);
        return {
          href: resolvedHref,
          as: asProp ? (0, _resolvehref.resolveHref)(router, asProp) : resolvedAs || resolvedHref
        };
      }, [
        router,
        hrefProp,
        asProp
      ]);
      const previousHref = _react.default.useRef(href);
      const previousAs = _react.default.useRef(as);
      let child;
      if (legacyBehavior) {
        if (process.env.NODE_ENV === "development") {
          if (onClick) {
            console.warn(`"onClick" was passed to <Link> with \`href\` of \`${hrefProp}\` but "legacyBehavior" was set. The legacy behavior requires onClick be set on the child of next/link`);
          }
          if (onMouseEnterProp) {
            console.warn(`"onMouseEnter" was passed to <Link> with \`href\` of \`${hrefProp}\` but "legacyBehavior" was set. The legacy behavior requires onMouseEnter be set on the child of next/link`);
          }
          try {
            child = _react.default.Children.only(children);
          } catch (err) {
            if (!children) {
              throw Object.defineProperty(new Error(`No children were passed to <Link> with \`href\` of \`${hrefProp}\` but one child is required https://nextjs.org/docs/messages/link-no-children`), "__NEXT_ERROR_CODE", {
                value: "E320",
                enumerable: false,
                configurable: true
              });
            }
            throw Object.defineProperty(new Error(`Multiple children were passed to <Link> with \`href\` of \`${hrefProp}\` but only one child is supported https://nextjs.org/docs/messages/link-multiple-children` + (typeof window !== "undefined" ? " \nOpen your browser's console to view the Component stack trace." : "")), "__NEXT_ERROR_CODE", {
              value: "E266",
              enumerable: false,
              configurable: true
            });
          }
        } else {
          child = _react.default.Children.only(children);
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          if (children?.type === "a") {
            throw Object.defineProperty(new Error("Invalid <Link> with <a> child. Please remove <a> or use <Link legacyBehavior>.\nLearn more: https://nextjs.org/docs/messages/invalid-new-link-with-extra-anchor"), "__NEXT_ERROR_CODE", {
              value: "E209",
              enumerable: false,
              configurable: true
            });
          }
        }
      }
      const childRef = legacyBehavior ? child && typeof child === "object" && child.ref : forwardedRef;
      const [setIntersectionRef, isVisible, resetVisible] = (0, _useintersection.useIntersection)({
        rootMargin: "200px"
      });
      const setIntersectionWithResetRef = _react.default.useCallback((el) => {
        if (previousAs.current !== as || previousHref.current !== href) {
          resetVisible();
          previousAs.current = as;
          previousHref.current = href;
        }
        setIntersectionRef(el);
      }, [
        as,
        href,
        resetVisible,
        setIntersectionRef
      ]);
      const setRef = (0, _usemergedref.useMergedRef)(setIntersectionWithResetRef, childRef);
      _react.default.useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
          return;
        }
        if (!router) {
          return;
        }
        if (!isVisible || !prefetchEnabled) {
          return;
        }
        prefetch(router, href, as, {
          locale
        });
      }, [
        as,
        href,
        isVisible,
        locale,
        prefetchEnabled,
        router?.locale,
        router
      ]);
      const childProps = {
        ref: setRef,
        onClick(e) {
          if (process.env.NODE_ENV !== "production") {
            if (!e) {
              throw Object.defineProperty(new Error(`Component rendered inside next/link has to pass click event to "onClick" prop.`), "__NEXT_ERROR_CODE", {
                value: "E312",
                enumerable: false,
                configurable: true
              });
            }
          }
          if (!legacyBehavior && typeof onClick === "function") {
            onClick(e);
          }
          if (legacyBehavior && child.props && typeof child.props.onClick === "function") {
            child.props.onClick(e);
          }
          if (!router) {
            return;
          }
          if (e.defaultPrevented) {
            return;
          }
          linkClicked(e, router, href, as, replace, shallow, scroll, locale, onNavigate);
        },
        onMouseEnter(e) {
          if (!legacyBehavior && typeof onMouseEnterProp === "function") {
            onMouseEnterProp(e);
          }
          if (legacyBehavior && child.props && typeof child.props.onMouseEnter === "function") {
            child.props.onMouseEnter(e);
          }
          if (!router) {
            return;
          }
          prefetch(router, href, as, {
            locale,
            priority: true,
            // @see {https://github.com/vercel/next.js/discussions/40268?sort=top#discussioncomment-3572642}
            bypassPrefetchedCheck: true
          });
        },
        onTouchStart: process.env.__NEXT_LINK_NO_TOUCH_START ? void 0 : function onTouchStart(e) {
          if (!legacyBehavior && typeof onTouchStartProp === "function") {
            onTouchStartProp(e);
          }
          if (legacyBehavior && child.props && typeof child.props.onTouchStart === "function") {
            child.props.onTouchStart(e);
          }
          if (!router) {
            return;
          }
          prefetch(router, href, as, {
            locale,
            priority: true,
            // @see {https://github.com/vercel/next.js/discussions/40268?sort=top#discussioncomment-3572642}
            bypassPrefetchedCheck: true
          });
        }
      };
      if ((0, _utils.isAbsoluteUrl)(as)) {
        childProps.href = as;
      } else if (!legacyBehavior || passHref || child.type === "a" && !("href" in child.props)) {
        const curLocale = typeof locale !== "undefined" ? locale : router?.locale;
        const localeDomain = router?.isLocaleDomain && (0, _getdomainlocale.getDomainLocale)(as, curLocale, router?.locales, router?.domainLocales);
        childProps.href = localeDomain || (0, _addbasepath.addBasePath)((0, _addlocale.addLocale)(as, curLocale, router?.defaultLocale));
      }
      if (legacyBehavior) {
        if (process.env.NODE_ENV === "development") {
          (0, _erroronce.errorOnce)("`legacyBehavior` is deprecated and will be removed in a future release. A codemod is available to upgrade your components:\n\nnpx @next/codemod@latest new-link .\n\nLearn more: https://nextjs.org/docs/app/building-your-application/upgrading/codemods#remove-a-tags-from-link-components");
        }
        return /* @__PURE__ */ _react.default.cloneElement(child, childProps);
      }
      return /* @__PURE__ */ (0, _jsxruntime.jsx)("a", {
        ...restProps,
        ...childProps,
        children
      });
    });
    var LinkStatusContext = /* @__PURE__ */ (0, _react.createContext)({
      // We do not support link status in the Pages Router, so we always return false
      pending: false
    });
    var useLinkStatus = () => {
      return (0, _react.useContext)(LinkStatusContext);
    };
    var _default = Link2;
    if ((typeof exports2.default === "function" || typeof exports2.default === "object" && exports2.default !== null) && typeof exports2.default.__esModule === "undefined") {
      Object.defineProperty(exports2.default, "__esModule", { value: true });
      Object.assign(exports2.default, exports2);
      module2.exports = exports2.default;
    }
  }
});

// ../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/link.js
var require_link2 = __commonJS({
  "../../node_modules/.pnpm/next@16.2.6_@babel+core@7.29.0_@opentelemetry+api@1.9.0_@playwright+test@1.60.0_babel-p_172a91d94e279b0b6d26e71653641b2b/node_modules/next/link.js"(exports2, module2) {
    "use strict";
    module2.exports = require_link();
  }
});

// components/ui/artifact-row.tsx
var artifact_row_exports = {};
__export(artifact_row_exports, {
  ArtifactRow: () => ArtifactRow
});
module.exports = __toCommonJS(artifact_row_exports);

// components/ui/dropdown-menu.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_lucide_react = require("lucide-react");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/dropdown-menu.tsx
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React2.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.DropdownMenu.Trigger,
    {
      "data-slot": "dropdown-menu-trigger",
      ...props,
      id
    }
  );
}
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui.DropdownMenu.Portal, null, /* @__PURE__ */ React2.createElement(
    import_radix_ui.DropdownMenu.Content,
    {
      "data-slot": "dropdown-menu-content",
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
        className
      ),
      ...props
    }
  ));
}
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.DropdownMenu.Item,
    {
      "data-slot": "dropdown-menu-item",
      "data-inset": inset,
      "data-variant": variant,
      className: cn(
        "focus:!bg-muted focus:text-foreground data-[highlighted]:!bg-muted hover:!bg-muted hover:text-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:!bg-destructive/8 data-[variant=destructive]:focus:!bg-destructive/8 data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 dark:data-[variant=destructive]:hover:!bg-destructive/8 dark:data-[variant=destructive]:focus:!bg-destructive/8 dark:data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg:not([class*='text-'])]:text-current focus:[&_svg:not([class*='text-'])]:text-current data-[highlighted]:[&_svg:not([class*='text-'])]:text-current relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}

// components/ui/priority-icon.tsx
var React3 = __toESM(require("react"));
function PriorityIcon({
  priority,
  size = 16,
  className,
  ...props
}) {
  if (priority === "URGENT") {
    return /* @__PURE__ */ React3.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      /* @__PURE__ */ React3.createElement(
        "rect",
        {
          x: 1,
          y: 0,
          width: 14,
          height: 16,
          rx: 1.5,
          fill: "currentColor"
        }
      ),
      /* @__PURE__ */ React3.createElement(
        "rect",
        {
          x: 7,
          y: 3,
          width: 2,
          height: 7,
          rx: 1,
          style: { fill: "var(--background, #fff)" }
        }
      ),
      /* @__PURE__ */ React3.createElement(
        "rect",
        {
          x: 7,
          y: 11.5,
          width: 2,
          height: 2,
          rx: 1,
          style: { fill: "var(--background, #fff)" }
        }
      )
    );
  }
  const activeCount = ACTIVE_BAR_COUNT[priority] ?? 3;
  return /* @__PURE__ */ React3.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React3.createElement(
      "rect",
      {
        x: 1,
        y: 10,
        width: 3,
        height: 6,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 1 ? 1 : 0.3
      }
    ),
    /* @__PURE__ */ React3.createElement(
      "rect",
      {
        x: 6.5,
        y: 6,
        width: 3,
        height: 10,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 2 ? 1 : 0.3
      }
    ),
    /* @__PURE__ */ React3.createElement(
      "rect",
      {
        x: 12,
        y: 0,
        width: 3,
        height: 16,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 3 ? 1 : 0.3
      }
    )
  );
}
var ACTIVE_BAR_COUNT = { LOW: 1, MEDIUM: 2, HIGH: 3 };

// components/ui/status-icon.tsx
var React5 = __toESM(require("react"));

// components/ui/internal/status-icon-shared.tsx
var React4 = __toESM(require("react"));
var CENTER = 10;
var RADIUS = 9;
var STROKE_WIDTH = 2;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
var INNER_PATH_RADIUS = 3;
var INNER_STROKE_WIDTH = INNER_PATH_RADIUS * 2;
var INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_PATH_RADIUS;
var ICON_STROKE_WIDTH = 1.66;
function FilledCheckCircle({ fill }) {
  return /* @__PURE__ */ React4.createElement(React4.Fragment, null, /* @__PURE__ */ React4.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React4.createElement(
    "path",
    {
      d: "M6.5 10.5L9.5 13.5L14 7.5",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      fill: "none"
    }
  ));
}
function FilledXCircle({ fill }) {
  return /* @__PURE__ */ React4.createElement(React4.Fragment, null, /* @__PURE__ */ React4.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React4.createElement(
    "path",
    {
      d: "M7 7L13 13M13 7L7 13",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      fill: "none"
    }
  ));
}

// components/ui/status-icon.tsx
var STATUS_LABELS = {
  backlog: "Backlog",
  todo: "To do",
  started: "In Progress",
  "in-progress": "In progress",
  "in-review": "In review",
  executed: "Executed",
  complete: "Complete",
  "wont-do": "Won't do",
  decorative: "Status"
};
function getStatusConfig(status) {
  switch (status) {
    case "backlog": {
      return { percentage: 0, color: "var(--progress)", dashed: true, filled: false, icon: null };
    }
    case "todo": {
      return { percentage: 0, color: "var(--progress)", dashed: false, filled: false, icon: null };
    }
    case "started": {
      return { percentage: 25, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-progress": {
      return { percentage: 48.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-review": {
      return { percentage: 73.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "executed": {
      return { percentage: 100, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "complete": {
      return { percentage: 100, color: "var(--success)", dashed: false, filled: true, icon: "check" };
    }
    case "wont-do": {
      return { percentage: 100, color: "var(--foreground)", dashed: false, filled: true, icon: "x" };
    }
    default: {
      return { percentage: 48.5, color: "var(--muted-foreground)", dashed: false, filled: false, icon: null, trackColor: "var(--muted-foreground)", strokeWidth: 1.5 };
    }
  }
}
function StatusIcon({
  status,
  size = 16,
  thinking = false,
  className,
  ...props
}) {
  const config = getStatusConfig(status);
  const defaultLabel = STATUS_LABELS[status];
  if (config.filled) {
    return /* @__PURE__ */ React5.createElement(
      "svg",
      {
        role: "img",
        "aria-label": defaultLabel,
        "data-slot": "status-icon",
        width: size,
        height: size,
        viewBox: "0 0 20 20",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      config.icon === "check" && /* @__PURE__ */ React5.createElement(FilledCheckCircle, { fill: config.color }),
      config.icon === "x" && /* @__PURE__ */ React5.createElement(FilledXCircle, { fill: config.color })
    );
  }
  const sw = config.strokeWidth ?? STROKE_WIDTH;
  const outerOffset = CIRCUMFERENCE * (1 - config.percentage / 100);
  const innerOffset = INNER_CIRCUMFERENCE * (1 - config.percentage / 100);
  const spinnerDash = CIRCUMFERENCE * 0.25;
  const spinnerGap = CIRCUMFERENCE - spinnerDash;
  const hasArc = config.percentage > 0;
  return /* @__PURE__ */ React5.createElement(
    "svg",
    {
      role: "img",
      "aria-label": defaultLabel,
      "data-slot": "status-icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React5.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.trackColor ?? "var(--progress)",
        strokeWidth: sw,
        fill: "none",
        strokeDasharray: config.dashed ? "3 3" : void 0
      }
    ),
    !thinking && hasArc && /* @__PURE__ */ React5.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.color,
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: CIRCUMFERENCE,
        strokeDashoffset: outerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    ),
    thinking && /* @__PURE__ */ React5.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--thinking)",
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: `${spinnerDash} ${spinnerGap}`,
        className: "animate-spin origin-center"
      }
    ),
    hasArc && /* @__PURE__ */ React5.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: INNER_PATH_RADIUS,
        stroke: config.color,
        strokeWidth: INNER_STROKE_WIDTH,
        fill: "none",
        strokeDasharray: INNER_CIRCUMFERENCE,
        strokeDashoffset: innerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    )
  );
}

// components/ui/tooltip.tsx
var React6 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
function TooltipProvider({
  delayDuration = 700,
  ...props
}) {
  return /* @__PURE__ */ React6.createElement(
    import_radix_ui2.Tooltip.Provider,
    {
      "data-slot": "tooltip-provider",
      delayDuration,
      ...props
    }
  );
}
function Tooltip({
  ...props
}) {
  return /* @__PURE__ */ React6.createElement(TooltipProvider, null, /* @__PURE__ */ React6.createElement(import_radix_ui2.Tooltip.Root, { "data-slot": "tooltip", ...props }));
}
function TooltipTrigger({
  ...props
}) {
  return /* @__PURE__ */ React6.createElement(import_radix_ui2.Tooltip.Trigger, { "data-slot": "tooltip-trigger", ...props });
}
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}) {
  return /* @__PURE__ */ React6.createElement(import_radix_ui2.Tooltip.Portal, null, /* @__PURE__ */ React6.createElement(
    import_radix_ui2.Tooltip.Content,
    {
      "data-slot": "tooltip-content",
      sideOffset,
      className: cn(
        "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
        className
      ),
      ...props
    },
    children,
    /* @__PURE__ */ React6.createElement(import_radix_ui2.Tooltip.Arrow, { className: "bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" })
  ));
}

// components/ui/artifact-row.tsx
var import_lucide_react2 = require("lucide-react");
var import_link = __toESM(require_link2());
function ArtifactRow({
  title,
  slug,
  typeIcon,
  typeLabel,
  status,
  statusLabel,
  priority,
  assignee,
  href,
  depth = 1,
  onDetach,
  className
}) {
  const isChild = depth > 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "group/row relative flex items-center gap-2 border-b py-2.5 pr-2 pl-2 hover:bg-accent/50",
        href ? "cursor-pointer" : "cursor-default",
        className
      )
    },
    isChild ? /* @__PURE__ */ React.createElement(
      import_lucide_react2.CornerDownRightIcon,
      {
        "aria-hidden": true,
        className: "h-4 w-4 shrink-0 text-muted-foreground opacity-50"
      }
    ) : null,
    /* @__PURE__ */ React.createElement("span", { className: "flex shrink-0 items-center text-muted-foreground" }, typeIcon),
    /* @__PURE__ */ React.createElement("span", { className: "mr-1.5 ml-1 inline-block min-w-[7ch] shrink-0 font-mono text-muted-foreground text-xs" }, slug),
    /* @__PURE__ */ React.createElement(Tooltip, null, /* @__PURE__ */ React.createElement(TooltipTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": statusLabel,
        className: "relative z-10 inline-flex shrink-0 items-center",
        type: "button"
      },
      /* @__PURE__ */ React.createElement(StatusIcon, { size: 16, status })
    )), /* @__PURE__ */ React.createElement(TooltipContent, null, statusLabel)),
    href ? /* @__PURE__ */ React.createElement(
      import_link.default,
      {
        className: "min-w-0 flex-1 truncate font-medium text-sm after:absolute after:inset-0",
        href
      },
      title
    ) : /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate font-medium text-sm" }, title),
    /* @__PURE__ */ React.createElement("div", { className: "relative z-10 flex shrink-0 items-center gap-4" }, assignee, priority ? /* @__PURE__ */ React.createElement("div", { className: "flex h-5 w-5 items-center justify-center" }, /* @__PURE__ */ React.createElement(PriorityIcon, { priority })) : null, /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": "More actions",
        className: "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground",
        type: "button"
      },
      /* @__PURE__ */ React.createElement(import_lucide_react2.EllipsisIcon, { className: "h-4 w-4" })
    )), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, href ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { asChild: true }, /* @__PURE__ */ React.createElement(import_link.default, { href }, /* @__PURE__ */ React.createElement(import_lucide_react2.ExternalLinkIcon, { className: "h-4 w-4" }), "View ", typeLabel)) : /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: true }, /* @__PURE__ */ React.createElement(import_lucide_react2.ExternalLinkIcon, { className: "h-4 w-4" }), "View ", typeLabel), /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !onDetach, onClick: onDetach }, /* @__PURE__ */ React.createElement(import_lucide_react2.Link2OffIcon, { className: "h-4 w-4" }), "Detach Association"))))
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ArtifactRow
});
//# sourceMappingURL=artifact-row.js.map