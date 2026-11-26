# 人工审查的扩充软件规则

本文件只收录可说明来源的安装/缓存目录结构：JetBrains 官方安装目录约定、Unreal Engine 的 DerivedDataCache/项目结构、Discord 桌面客户端的 Electron 用户数据目录布局。四种回归样本随缓存规则一起声明；拿不准的目录不进入内置库。

## jetbrains-caches
- name: caches|index|log
- pathRegex: JetBrains/[^/]+/(caches|index|log)$
- owner: JetBrains IDEs
- ownerKind: dev_tool
- purpose: IntelliJ IDEA、PyCharm、WebStorm 等 JetBrains IDE 的索引、编译缓存和运行日志
- verdict: safe_delete
- confidence: 0.91
- rebuildable: true
- reason: 这些目录由 IDE 根据项目与插件重新生成，不含源码、项目配置或版本库历史。
- consequence: 下次打开项目会重新建立索引，通常可重建但首次打开较慢；隔离前请退出 IDE，并保留项目目录与版本库。
- revival: none
- software: JetBrains IDEs
- vendor: JetBrains
- aliases: IntelliJ IDEA|PyCharm|WebStorm|GoLand|CLion|Rider|DataGrip
- platforms: windows
- installPaths: JetBrains/Toolbox/apps|Program Files/JetBrains
- cachePaths: AppData/Local/JetBrains/<product>/caches|AppData/Local/JetBrains/<product>/index
- logPaths: AppData/Local/JetBrains/<product>/log
- configPaths: AppData/Roaming/JetBrains/<product>/options
- userDataPaths: AppData/Roaming/JetBrains/<product>/plugins
- processNames: idea64.exe|pycharm64.exe|webstorm64.exe
- fileTypes: .index|.log
- protectMarkers: options|plugins
- protectVerdict: needs_review
- role: rebuildable_cache
- ruleVersion: 4
- verifiedAt: 2026-11-26
- sampleCache: AppData/Local/JetBrains/IntelliJIdea2025.2/caches
- sampleReview: AppData/Roaming/JetBrains/IntelliJIdea2025.2/plugins
- sampleProtect: AppData/Roaming/JetBrains/IntelliJIdea2025.2/options
- sampleNegative: Documents/JetBrainsNotes

## jetbrains-plugins
- pathRegex: JetBrains/[^/]+/plugins$
- owner: JetBrains IDEs
- ownerKind: dev_tool
- purpose: 用户安装的 JetBrains IDE 插件目录
- verdict: needs_review
- confidence: 0.86
- rebuildable: false
- reason: 插件可从市场重新安装，但授权、版本与用户安装的第三方插件不一定能原样恢复。
- consequence: 隔离后 IDE 可能缺少插件功能；应先在 IDE 中记录插件清单并确认配置可恢复。
- revival: none
- software: JetBrains IDEs
- vendor: JetBrains
- platforms: windows
- role: configuration
- ruleVersion: 4
- verifiedAt: 2026-11-26

## jetbrains-options
- pathRegex: JetBrains/[^/]+/options$
- owner: JetBrains IDEs
- ownerKind: dev_tool
- purpose: JetBrains IDE 的键位、编辑器、插件与授权相关配置
- verdict: keep_locked
- confidence: 0.94
- rebuildable: false
- reason: 包含用户自定义设置，可能与许可证和插件配置相关，删除后难以恢复。
- consequence: 删除会导致个人配置丢失，因此默认锁定，不参与勾选。
- revival: none
- software: JetBrains IDEs
- vendor: JetBrains
- platforms: windows
- role: protected_data
- ruleVersion: 4
- verifiedAt: 2026-11-26

## unreal-derived-data-cache
- pathRegex: UnrealEngine/Common/DerivedDataCache$
- owner: Unreal Engine
- ownerKind: dev_tool
- purpose: Unreal Engine 跨项目共享的推导数据缓存（DDC）
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: DDC 是根据资源与着色器重新计算出的缓存，不属于项目资产或源代码。
- consequence: 重新打开或构建项目时会产生较长的着色器编译时间，缓存会逐步重建。
- revival: none
- software: Unreal Engine
- vendor: Epic Games
- aliases: UE|UE5
- platforms: windows
- installPaths: Program Files/Epic Games/UE_5*
- cachePaths: AppData/Local/UnrealEngine/Common/DerivedDataCache
- configPaths: AppData/Local/Unreal Engine/Saved/Config
- userDataPaths: Documents/Unreal Projects
- processNames: UnrealEditor.exe
- fileTypes: .ddc|.upipelinecache
- protectMarkers: Content|Config
- protectVerdict: keep_locked
- role: rebuildable_cache
- ruleVersion: 4
- verifiedAt: 2026-11-26
- sampleCache: AppData/Local/UnrealEngine/Common/DerivedDataCache
- sampleReview: Documents/Unreal Projects/MyGame/Intermediate
- sampleProtect: Documents/Unreal Projects/MyGame/Content
- sampleNegative: Documents/Unreal Notes

## unreal-intermediate
- pathRegex: Unreal Projects/[^/]+/Intermediate$
- owner: Unreal Engine
- ownerKind: dev_tool
- purpose: Unreal 项目构建中间产物
- verdict: needs_review
- confidence: 0.84
- rebuildable: true
- reason: 中间文件可重新构建，但清理前需确认项目未运行且构建配置已保存。
- consequence: 下次构建需要更长时间；若项目正在编译，隔离会中断构建。
- revival: process_lock
- software: Unreal Engine
- vendor: Epic Games
- platforms: windows
- role: update_residue
- ruleVersion: 4
- verifiedAt: 2026-11-26

## unreal-project-content
- pathRegex: Unreal Projects/[^/]+/Content$
- owner: Unreal Engine
- ownerKind: dev_tool
- purpose: Unreal 项目的内容资产（关卡、蓝图、美术资源）
- verdict: keep_locked
- confidence: 0.97
- rebuildable: false
- reason: 这是项目核心资产，不是构建缓存；删除可能造成不可替代的内容丢失。
- consequence: 项目将无法完整打开或资源丢失，默认锁定。
- revival: none
- software: Unreal Engine
- vendor: Epic Games
- platforms: windows
- role: protected_data
- ruleVersion: 4
- verifiedAt: 2026-11-26

## discord-electron-cache
- pathRegex: discord/(Cache|Code Cache|GPUCache)$
- owner: Discord
- ownerKind: app
- purpose: Discord 桌面客户端的网页资源、脚本和 GPU 缓存
- verdict: safe_delete
- confidence: 0.9
- rebuildable: true
- reason: 这些是 Electron/Chromium 产生的可再生缓存，不包含聊天数据库或登录令牌。
- consequence: 首次打开频道或界面时重新下载资源，稍慢；请先退出 Discord，避免文件被占用。
- revival: process_lock
- software: Discord
- vendor: Discord Inc.
- platforms: windows
- installPaths: AppData/Local/Discord
- cachePaths: AppData/Roaming/discord/Cache|AppData/Roaming/discord/Code Cache|AppData/Roaming/discord/GPUCache
- configPaths: AppData/Roaming/discord/settings.json
- userDataPaths: AppData/Roaming/discord/Local Storage|AppData/Roaming/discord/Session Storage
- processNames: Discord.exe
- fileTypes: .ldb|.log
- protectMarkers: Local Storage|Session Storage|Cookies|Login Data
- protectVerdict: keep_locked
- role: rebuildable_cache
- ruleVersion: 4
- verifiedAt: 2026-11-26
- sampleCache: AppData/Roaming/discord/Cache
- sampleReview: AppData/Roaming/discord/Service Worker
- sampleProtect: AppData/Roaming/discord/Local Storage
- sampleNegative: Documents/DiscordProjects

## discord-service-worker
- pathRegex: discord/Service Worker$
- owner: Discord
- ownerKind: app
- purpose: Discord 客户端的离线 Service Worker 脚本与缓存清单
- verdict: needs_review
- confidence: 0.82
- rebuildable: true
- reason: 通常可重新下载，但可能与当前客户端版本和离线状态相关，先退出客户端再确认。
- consequence: 离线界面或通知可能暂时异常，重新联网启动后会恢复。
- revival: process_lock
- software: Discord
- vendor: Discord Inc.
- platforms: windows
- role: rebuildable_cache
- ruleVersion: 4
- verifiedAt: 2026-11-26

## discord-user-session
- pathRegex: discord/(Local Storage|Session Storage|Cookies|Login Data)$
- owner: Discord
- ownerKind: app
- purpose: Discord 的登录会话、Cookie 与本地存储
- verdict: keep_locked
- confidence: 0.96
- rebuildable: false
- reason: 包含登录令牌和会话数据，删除会导致退登并可能丢失本地状态。
- consequence: 需要重新登录，不能作为缓存清理；默认锁定。
- revival: none
- software: Discord
- vendor: Discord Inc.
- platforms: windows
- role: protected_data
- ruleVersion: 4
- verifiedAt: 2026-11-26
