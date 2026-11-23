# 浏览器指纹规则

## chrome-cache
- name: Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache
- pathRegex: (Google/Chrome|Chromium)/User Data
- owner: Chrome
- ownerKind: cache
- purpose: Chrome 的网页缓存、JS 字节码缓存和 GPU 着色器缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 浏览器把看过的网页图片、脚本临时存在这里以便下次秒开，全部可以重新下载，不含账号密码和书签。
- consequence: 删掉后常逛的网站首次打开稍慢（重新下载资源），登录状态、书签、密码都不受影响。建议先关闭 Chrome，否则部分文件被占用删不掉。
- revival: process_lock

## chrome-service-worker
- pathRegex: (Google/Chrome|Chromium)/User Data/[^/]+/Service Worker/(CacheStorage|ScriptCache)$
- owner: Chrome
- ownerKind: cache
- purpose: 网站 Service Worker 的离线资源与脚本缓存（PWA 离线页面）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 存的是网站为了离线可用而预存的资源副本，网站本身的数据在服务器上，删了会按需重新拉取。
- consequence: 某些网站的离线功能暂时失效，下次联网访问时自动重建；个别 PWA 应用可能需要刷新一次。先关闭浏览器再删。
- revival: process_lock

## chrome-crashpad
- name: Crashpad
- pathRegex: Google/Chrome|Chromium
- owner: Chrome
- ownerKind: cache
- purpose: Chrome 崩溃时生成的错误报告与转储文件
- verdict: safe_delete
- confidence: 0.88
- rebuildable: false
- reason: 只有浏览器崩溃时才写东西，是给开发者排障用的报告，对普通用户没有保留价值。
- consequence: 删掉不影响浏览器任何功能，只是丢失历史崩溃记录；如果最近频繁崩溃想排查原因，可以先留着。
- revival: none

## edge-cache
- name: Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache
- pathRegex: Microsoft/Edge/User Data
- owner: Edge
- ownerKind: cache
- purpose: Edge 的网页缓存、JS 字节码缓存和 GPU 着色器缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 和 Chrome 同源（Chromium 内核），这里全是可再生的网页临时资源，不含收藏夹、密码和登录状态。
- consequence: 常逛网站首次打开稍慢，其余无影响；先关闭 Edge 再删，避免文件占用。
- revival: process_lock

## edge-service-worker
- pathRegex: Microsoft/Edge/User Data/[^/]+/Service Worker/(CacheStorage|ScriptCache)$
- owner: Edge
- ownerKind: cache
- purpose: Edge 中网站 Service Worker 的离线资源缓存
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 网站预存的离线资源副本，服务器上有原件，删除后联网访问会重新生成。
- consequence: 个别网站离线功能暂时失效，联网后自动恢复；先关闭 Edge 再删。
- revival: process_lock

## firefox-cache2
- pathRegex: Mozilla/Firefox/Profiles/[^/]+/cache2$
- owner: Firefox
- ownerKind: cache
- purpose: Firefox 的网页磁盘缓存
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 看过的网页资源临时副本，全部可重新下载；Firefox 的书签、密码存在别处（places.sqlite 等），不在这里。
- consequence: 常逛网站首次加载稍慢，其余无影响；建议先关闭 Firefox。
- revival: process_lock

## firefox-startup-shader
- name: startupCache|shader-cache
- pathContains: Mozilla/Firefox
- owner: Firefox
- ownerKind: cache
- purpose: Firefox 的启动脚本缓存与 GPU 着色器缓存
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 为了让浏览器启动更快、网页渲染更顺而预编译的缓存，删了会自动重新编译。
- consequence: 下次启动浏览器和首次打开复杂网页稍慢，之后恢复正常，不丢任何个人数据。
- revival: none

## firefox-crashes
- name: crashes|Crash Reports
- pathContains: Mozilla
- owner: Firefox
- ownerKind: cache
- purpose: Firefox 崩溃报告与迷你转储文件
- verdict: safe_delete
- confidence: 0.88
- rebuildable: false
- reason: 浏览器崩溃时留下的诊断材料，普通用户用不上，也不会影响浏览器运行。
- consequence: 删除无功能影响，仅丢失历史崩溃记录；正在排查崩溃问题时建议暂缓。
- revival: none

## inetcache
- name: INetCache
- pathContains: AppData/Local/Microsoft/Windows
- owner: Windows (IE/系统网络组件)
- ownerKind: system
- purpose: IE 及系统网络组件遗留的网页缓存目录
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: IE 时代留下的网页缓存，现在主要被系统组件偶尔使用，内容都是可再生的网络资源。
- consequence: 删除后相关组件重新下载资源；个别文件可能被系统占用，跳过即可。
- revival: process_lock