# 云盘与同步盘指纹规则

## onedrive-sync-root
- glob: OneDrive*
- pathRegex: /Users/[^/]+/OneDrive
- owner: OneDrive
- ownerKind: app
- purpose: OneDrive 的本地同步根目录，与云端双向同步
- verdict: keep_locked
- confidence: 0.85
- rebuildable: false
- reason: 这不是缓存！在同步目录里删文件，OneDrive 会把云端对应文件一起删掉；部分文件还是「仅联机」占位符，本地看似很小，云端却是真数据。
- consequence: 误删会同步删除云端文件（云端回收站有保留期限，过期即永久丢失）。想释放空间请用 OneDrive 的「释放空间」功能把文件转为仅联机，而不是删除。
- revival: autostart_service

## onedrive-appdata
- pathRegex: AppData/Local/Microsoft/OneDrive$
- owner: OneDrive
- ownerKind: app
- purpose: OneDrive 客户端程序、更新包与运行日志
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 这里是客户端本体和日志，不是同步的文件；日志可清，但程序文件删了 OneDrive 会坏。
- consequence: 整体删除会导致 OneDrive 无法启动、同步中断；只建议清理其中 logs 子目录，或走官方卸载/重装流程。
- revival: run_key

## dropbox-sync-root
- name: Dropbox
- pathRegex: /Users/[^/]+/Dropbox$
- owner: Dropbox
- ownerKind: app
- purpose: Dropbox 的本地同步根目录
- verdict: keep_locked
- confidence: 0.85
- rebuildable: false
- reason: 与 OneDrive 同理：同步目录里的删除操作会传播到云端和其他设备，这里的内容是真实文件而非缓存。
- consequence: 误删会连带删除云端文件（Dropbox 有版本历史/回收站可救，但有期限）。释放空间请用选择性同步，不要直接删目录。
- revival: autostart_service

## nutstore-sync-root
- name: Nutstore|我的坚果云
- owner: 坚果云
- ownerKind: app
- purpose: 坚果云的本地同步文件夹
- verdict: keep_locked
- confidence: 0.8
- rebuildable: false
- reason: 同步盘根目录，里面的删除会同步到云端；坚果云常被用来同步工作文档和论文，价值密度高。
- consequence: 误删会同步删除云端文件，虽然坚果云有回收站和历史版本，但超期后无法恢复。请保留，或在客户端里管理同步范围。
- revival: autostart_service

## baidu-download-dir
- name: BaiduNetdiskDownload|BaiduYunDownload
- owner: 百度网盘
- ownerKind: app
- purpose: 百度网盘的默认下载目录
- verdict: needs_review
- confidence: 0.75
- rebuildable: false
- reason: 这里是你主动从网盘下载回来的文件，可能混着看完的安装包和舍不得删的资料，不能当缓存一刀切。
- consequence: 删除后本地副本消失；若网盘云端原件还在可重新下载，但下载耗时耗流量，部分分享链接可能已失效。建议逐个甄别。
- revival: none

## baidu-residue
- name: BaiduNetdisk|BaiduYunGuanjia|baidu
- pathRegex: AppData|Program Files
- owner: 百度网盘
- ownerKind: app
- purpose: 百度网盘客户端的配置、缓存与组件目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 若网盘还在用，删了会丢配置甚至客户端损坏；若已卸载，这是残留，但它的后台服务和启动项可能还在，直接删文件夹会被重建。
- consequence: 先确认是否已卸载：未卸载请走官方卸载器；已卸载则先禁用相关启动项/服务/计划任务，再删目录，否则「删了又长出来」。
- revival: run_key, autostart_service, missing_uninstaller

## aliyun-quark-residue
- name: aDrive|aliyunpan|Quark|QuarkCloudDrive|夸克
- owner: 阿里云盘 / 夸克网盘
- ownerKind: app
- purpose: 阿里云盘或夸克网盘客户端的数据与缓存目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 在用则含账号配置与传输缓存；卸载后属残留。这类客户端普遍带开机启动和后台服务，残留目录可能被重新创建。
- consequence: 未卸载时删除会丢登录状态和传输记录；已卸载请先断启动项与服务再删目录，避免复活。下载目录里的个人文件请另行甄别。
- revival: run_key, autostart_service, missing_uninstaller

## thunder-residue
- name: Thunder Network|Thunder|XLLiveUD
- owner: 迅雷
- ownerKind: app
- purpose: 迅雷客户端组件、升级模块与缓存目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 迅雷以「卸载后残留多、后台组件自启」著称；XLLiveUD 之类升级模块常靠计划任务和服务维持，删文件夹治标不治本。
- consequence: 未卸载时删除会损坏客户端；已卸载请先在任务计划程序和服务里禁用迅雷相关条目，再删目录，否则会被后台组件重建。
- revival: autostart_service, scheduled_task, run_key, missing_uninstaller

## thunder-download-dir
- name: ThunderDownload|迅雷下载|TDDOWNLOAD
- owner: 迅雷
- ownerKind: app
- purpose: 迅雷的默认下载保存目录
- verdict: needs_review
- confidence: 0.75
- rebuildable: false
- reason: 下载回来的电影、安装包、压缩包都在这，体积大但属于个人数据；其中未下完的临时文件才是可清理部分。
- consequence: 删除后已下载内容丢失，重新下载耗时且部分资源可能失效；建议按文件类型甄别，优先清理 .xltd 等未完成任务残留。
- revival: none