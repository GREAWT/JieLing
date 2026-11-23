# 应用缓存指纹规则

## electron-app-cache
- name: Cache|Code Cache|GPUCache|DawnCache|ShaderCache
- pathContains: AppData/Roaming
- owner: 桌面应用（Chromium 内核）
- ownerKind: cache
- purpose: 钉钉、飞书、Slack、Discord 等 Electron 应用的网页资源缓存
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 这类应用内嵌浏览器内核，缓存结构和 Chrome 一样，存的都是可再生的界面资源，聊天记录和账号数据不在这里。
- consequence: 删掉后应用首次打开稍慢，重新拉取资源即可；请先退出对应应用，否则文件被占用删不干净。
- revival: process_lock

## vscode-cacheddata
- name: CachedData
- pathRegex: (Code|Cursor|VSCodium)/CachedData$
- owner: VS Code
- ownerKind: cache
- purpose: VS Code 按版本缓存的 JS 字节码，加快编辑器启动
- verdict: safe_delete
- confidence: 0.92
- rebuildable: true
- reason: 每个版本一个子目录，旧版本的缓存纯属遗留；你的代码、设置、扩展都不在这里。
- consequence: 删掉后下次启动 VS Code 稍慢（重新生成），无任何数据损失；扩展更新后旧缓存也会自然失效。
- revival: none

## vscode-logs
- name: logs
- pathRegex: (Code|Cursor|VSCodium)/logs$
- owner: VS Code
- ownerKind: cache
- purpose: VS Code 各窗口与扩展进程的运行日志
- verdict: safe_delete
- confidence: 0.92
- rebuildable: false
- reason: 按会话时间戳堆积的日志文件，只用于排障，长期累积可达数百 MB。
- consequence: 删除不影响编辑器任何功能；正在排查扩展报错时可先保留最近几天的日志。
- revival: none

## wechat-cache
- pathRegex: (WeChat Files|xwechat_files)/[^/]+/(FileStorage/)?(Cache|Temp)$
- owner: 微信
- ownerKind: cache
- purpose: 微信电脑版聊天图片/视频的临时缓存与缩略图
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 这是刷聊天时产生的临时副本，真正的聊天记录数据库和已接收文件在别的目录；缓存删了微信会按需重建。
- consequence: 部分聊天图片再次查看时需重新加载（很久以前的图片若服务器已过期可能无法再拉取，重要图片请先另存）；建议先退出微信。
- revival: process_lock

## wechat-received-files
- pathRegex: (WeChat Files|xwechat_files)/[^/]+/FileStorage/(File|Image|Video|MsgAttach)$
- owner: 微信
- ownerKind: app
- purpose: 微信聊天中接收/发送的文件、图片、视频原件
- verdict: needs_review
- confidence: 0.85
- rebuildable: false
- reason: 这里不是缓存，是别人发给你的合同、照片、工作文件的本地原件，很多只有这一份，微信服务器过期后就拉不回来了。
- consequence: 删除后聊天记录里对应文件显示「已过期或已被清理」，无法恢复。请先把有价值的文件另存到文档目录，再考虑清理。
- revival: none

## qq-filerecv
- name: FileRecv
- pathRegex: Tencent Files|QQ
- owner: QQ
- ownerKind: app
- purpose: QQ 接收文件的默认保存目录
- verdict: needs_review
- confidence: 0.85
- rebuildable: false
- reason: 别人通过 QQ 传给你的文件都落在这里，属于个人数据而非缓存，可能混着安装包和重要文档。
- consequence: 删除后文件无法从 QQ 服务器找回（离线文件有保存期限）；建议逐个甄别，把文档资料移走后再清理安装包。
- revival: none

## adobe-media-cache
- name: Media Cache|Media Cache Files
- pathContains: Adobe
- owner: Adobe Premiere / After Effects
- ownerKind: cache
- purpose: Adobe 视频剪辑工具的媒体缓存（音频波形、预览索引）
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 剪辑时为了流畅预览生成的索引文件，动辄几十 GB；素材原件不在这里，Adobe 官方支持在首选项里清理。
- consequence: 删掉后重新打开工程会重新生成缓存，大工程首次预览卡顿一会儿；工程文件和素材完全不受影响。
- revival: none

## spotify-storage
- pathRegex: Spotify/(Storage|Browser)$
- owner: Spotify
- ownerKind: cache
- purpose: Spotify 的流媒体缓存与离线歌曲存储
- verdict: needs_review
- confidence: 0.6
- rebuildable: true
- reason: 里面混着可再生缓存和你主动下载的离线歌曲；全删能省不少空间，但离线内容要重新下载。
- consequence: 离线歌曲需重新下载才能离线播放，缓存部分自动重建；更稳妥的做法是在 Spotify 设置里清除缓存或调整离线下载。
- revival: none

## netease-cache
- pathRegex: Netease/CloudMusic/(Cache|Temp)$
- owner: 网易云音乐
- ownerKind: cache
- purpose: 网易云音乐在线听歌的缓冲缓存
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 听歌时边播边存的临时数据，删了只是重新缓冲；你主动「下载」的歌曲在另行设置的下载目录里，不受影响。
- consequence: 常听的歌曲首次播放需重新缓冲，离线听缓存歌曲暂时失效；账号、歌单、下载歌曲均不受影响。
- revival: none

## steam-shadercache
- pathRegex: steamapps/shadercache$
- owner: Steam
- ownerKind: cache
- purpose: Steam 游戏的预编译着色器缓存
- verdict: safe_delete
- confidence: 0.88
- rebuildable: true
- reason: 为了减少游戏卡顿预编译的 GPU 着色器，按游戏 AppID 分目录，删了 Steam 会重新下载或编译。
- consequence: 删掉后对应游戏首次启动可能短暂卡顿（重新编译着色器），之后恢复；游戏本体和存档不受影响。
- revival: none

## nvidia-shader-cache
- pathRegex: NVIDIA/(DXCache|GLCache)$|NVIDIA Corporation/NV_Cache$
- owner: NVIDIA 驱动
- ownerKind: cache
- purpose: NVIDIA 显卡驱动的 DirectX/OpenGL 着色器缓存
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 驱动为加快游戏加载预编译的着色器，全部可再生；清理它也是解决某些游戏画面异常的常规手段。
- consequence: 删掉后游戏首次加载稍慢、可能短暂卡顿，驱动自动重建；不影响驱动本身与游戏存档。
- revival: none

## d3dscache
- name: D3DSCache
- pathContains: AppData/Local
- owner: Windows (Direct3D)
- ownerKind: system
- purpose: Direct3D 的着色器与管线状态缓存
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 系统为 3D 程序预编译的缓存数据，可再生，微软排障文档也认可清理。
- consequence: 3D 应用/游戏首次启动稍慢，之后自动重建；无数据损失。
- revival: none

## generic-crashpad
- name: Crashpad
- owner: 各类桌面应用
- ownerKind: cache
- purpose: Chromium 系应用通用的崩溃报告目录
- verdict: safe_delete
- confidence: 0.82
- rebuildable: false
- reason: 应用崩溃时写的诊断报告，平时为空或只有少量旧报告，对正常使用没有价值。
- consequence: 删除不影响应用功能，仅丢失崩溃历史；应用下次崩溃时会重建目录，属正常现象。
- revival: none