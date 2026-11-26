# 已卸载软件残留与捆绑全家桶指纹规则

## 2345-family
- glob: 2345*
- owner: 2345 全家桶
- ownerKind: app
- purpose: 2345 系软件（浏览器/看图王/好压/安全卫士等）的安装或数据目录
- verdict: needs_review
- confidence: 0.7
- rebuildable: false
- reason: 2345 系常随下载站安装包捆绑进场，卸载后残留目录、服务和计划任务齐全，是「删了又复活」的典型；但也要先确认不是你自己装着在用的。
- consequence: 直接删文件夹大概率被残留服务/计划任务重建。正确顺序：确认已卸载 → 禁用相关服务与计划任务、清理启动项 → 再删目录。仍在使用的组件请走官方卸载器。
- revival: autostart_service, scheduled_task, run_key, missing_uninstaller

## ludashi
- name: LuDaShi|ludashi|ComputerZ
- owner: 鲁大师
- ownerKind: app
- purpose: 鲁大师（硬件检测/跑分工具）的程序或数据目录
- verdict: needs_review
- confidence: 0.65
- rebuildable: false
- reason: 常由装机商或驱动安装包捆绑安装，带开机启动和定时推广任务；卸载不干净时目录会被后台组件重建。
- consequence: 在用别删（删了硬件监控失效）；已卸载请先清启动项和计划任务再删目录，否则复活。建议优先用官方卸载器。
- revival: run_key, scheduled_task, autostart_service

## driver-tools
- glob: DriverGenius*|DriveTheLife*
- owner: 驱动精灵 / 驱动人生
- ownerKind: app
- purpose: 第三方驱动安装工具的程序与驱动备份目录
- verdict: needs_review
- confidence: 0.65
- rebuildable: false
- reason: 这类工具常捆绑推广组件，且会往系统里装驱动级服务；目录里可能还有它备份的驱动包，重装系统时偶尔用得上。
- consequence: 已卸载的话先禁用其服务/计划任务再删目录；注意它安装的驱动不会随目录删除而消失，驱动问题请走设备管理器或官方渠道。
- revival: autostart_service, scheduled_task, run_key

## 360-family
- name: 360Safe|360sd|360Zip|360Chrome|360se6|360Total Security
- owner: 360 系软件
- ownerKind: app
- purpose: 360 安全卫士/杀毒/压缩/浏览器等组件的安装或数据目录
- verdict: needs_review
- confidence: 0.65
- rebuildable: false
- reason: 360 系组件互相拉起、带自保护驱动，卸载残留是「复活」重灾区；但如果你正在用 360，删目录会直接破坏防护功能。
- consequence: 在用请走官方卸载器（自保护驱动会拦截手动删除）；已卸载仍有残留时，先处理其服务与驱动项再清目录，必要时进安全模式操作。
- revival: autostart_service, driver_protected, scheduled_task, run_key

## qq-pc-mgr
- name: QQPCMgr|TencentQQPCMgr
- owner: 腾讯电脑管家
- ownerKind: app
- purpose: 腾讯电脑管家的程序与数据目录
- verdict: needs_review
- confidence: 0.65
- rebuildable: false
- reason: 安全类软件带自保护驱动和多个后台服务，手动删目录会被拦截或被服务重建；卸载不彻底时残留明显。
- consequence: 在用别手删；已卸载请先确认服务已移除再清目录，否则可能删一半失败留下损坏状态。推荐官方卸载器。
- revival: autostart_service, driver_protected, run_key

## kingsoft-security
- name: KSafe|Kingsoft Security|liebao|LIEBAO
- owner: 金山毒霸 / 猎豹浏览器
- ownerKind: app
- purpose: 金山毒霸或猎豹浏览器的安装与数据目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 毒霸带自保护驱动与开机服务，猎豹常作为捆绑组件出现；卸载残留会被启动项和服务重建。注意与 WPS 的 Kingsoft 目录区分，后者含办公数据。
- consequence: 在用请走官方卸载器；已卸载先断服务/启动项再删目录。误删 WPS 相关目录可能丢文档备份，删前看清路径。
- revival: autostart_service, driver_protected, run_key

## wps-office6
- pathRegex: kingsoft/office6
- owner: WPS Office
- ownerKind: app
- purpose: WPS 的配置、模板与文档备份中心数据
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 这里不是缓存：WPS 的「备份中心」把未保存/异常关闭文档的自动备份存在这一带，误删可能丢掉救命备份。
- consequence: 整体删除会丢配置、自定义模板和文档自动备份；想清空间请在 WPS 备份中心里按时间清理旧备份，保留近期文件。
- revival: none

## ime-residue
- name: SogouInput|SogouPY|QQInput|BaiduInput|iflyime
- owner: 搜狗/QQ/百度/讯飞输入法
- ownerKind: app
- purpose: 输入法的程序数据目录，含用户词库与配置
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 输入法还挂在系统里时删目录会导致打字异常；已卸载则是残留，但启动项可能重建目录。你的多年自造词词库也在这里，删前想清楚。
- consequence: 在用别删；已卸载先清启动项再删目录。词库删除后自造词、习惯排序全部丢失，云端有同步的可重新拉取。
- revival: run_key, missing_uninstaller

## kuaiya-haozip
- name: KuaiZip|HaoZip|快压|好压
- owner: 快压 / 好压
- ownerKind: app
- purpose: 国产压缩工具的安装与数据目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 快压等以捆绑推广和弹窗著称，卸载后常留外壳右键扩展和计划任务，目录被重建；好压相对正规但也需确认是否在用。
- consequence: 在用请走官方卸载器（会一并清右键菜单）；已卸载先清计划任务/启动项与外壳扩展再删目录，否则复活或右键菜单留死项。
- revival: run_key, shell_namespace, scheduled_task

## generic-assistant-master
- glob: *管家*|*大师*|*助手*
- owner: 疑似捆绑推广类工具
- ownerKind: unknown
- purpose: 名称带「管家/大师/助手」的软件目录，常见于捆绑安装
- verdict: needs_review
- confidence: 0.45
- rebuildable: false
- reason: 这类命名是捆绑推广软件的高频特征（清理大师、装机助手等），但也可能是你主动安装的正规工具，仅凭名字不能定罪。
- consequence: 请先确认是否认识这个软件：不认识的大概率是捆绑残留，按「断启动项/服务/计划任务 → 删目录」顺序处理；认识的请走官方卸载器。
- revival: run_key, scheduled_task, missing_uninstaller

## yuanqi-desktop
- name: 元气桌面|元气壁纸
- owner: 元气桌面（猎豹系）
- ownerKind: app
- purpose: 动态壁纸软件的程序与壁纸缓存目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 常随其他软件捆绑进场，壁纸缓存能占几个 GB，带开机启动和定时任务；卸载不干净时目录会重建。
- consequence: 在用别删（壁纸失效）；已卸载先清启动项与计划任务再删目录。下载的壁纸若有收藏价值请先另存。
- revival: run_key, scheduled_task

## shell-extension-residue
- name: shell|shellfolder|shellex|namespace|shelliconoverlayidentifiers|contextmenuhandlers
- owner: 疑似外壳扩展残留
- ownerKind: unknown
- purpose: 名称与 Windows 外壳扩展登记点一致的目录（右键菜单、「此电脑」里的虚拟文件夹）
- verdict: needs_review
- confidence: 0.5
- rebuildable: false
- reason: 这类名字是外壳扩展的登记点。资源管理器里看不到实体、却反复出现的目录，多半是注册表 NameSpace/CLSID 指向这里；但仅凭名字不能定罪，项目里也可能有普通的 shell 目录。
- consequence: 只删目录可能留下注册表登记或残留组件。请到「顽固软件诊断」生成只读脚本取证，确认登记归属并优先走官方卸载。
- revival: shell_namespace