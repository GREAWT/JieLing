# Windows 系统指纹规则

## windows-old
- name: Windows.old
- owner: Windows
- ownerKind: system
- purpose: 升级或重装 Windows 时自动备份的旧系统完整副本
- verdict: needs_review
- confidence: 0.85
- rebuildable: false
- reason: 通常有十几 GB，是清理大户。但它是你回退到旧系统的唯一通道，旧系统的桌面和文档里也可能还有没搬走的个人文件。
- consequence: 删掉后无法回退到旧版本 Windows，旧系统里的个人文件一并消失。确认新系统稳定、翻过旧桌面/文档后，建议用系统自带「磁盘清理」删除，比手动删更干净。
- revival: none

## windows-upgrade-temp
- name: $WINDOWS.~BT|$WINDOWS.~WS
- owner: Windows
- ownerKind: system
- purpose: Windows 更新/升级过程中的临时安装文件
- verdict: needs_review
- confidence: 0.75
- rebuildable: true
- reason: 升级助手下载和解压的安装材料，升级完成后就是遗留垃圾；但如果更新正在进行中，删了会导致更新失败。
- consequence: 确认近期没有正在进行的系统更新后可删，更新失败时系统会重新下载；推荐通过「磁盘清理」里的 Windows 更新清理来处理。
- revival: autostart_service

## user-temp
- name: Temp|tmp
- pathRegex: AppData/Local/Temp$|Windows/Temp$
- owner: Windows / 各类应用
- ownerKind: system
- purpose: 系统和应用程序的临时文件堆放处
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 程序解压安装包、导出中间文件都用这里，绝大多数是用完即弃的垃圾，常年累积可达数 GB。
- consequence: 正在被占用的文件删不掉，跳过即可；极个别安装器把卸载/回滚数据放在 Temp，刚装完重要软件时建议缓一两天再清。
- revival: process_lock

## prefetch
- name: Prefetch
- pathRegex: Windows/Prefetch$
- owner: Windows
- ownerKind: system
- purpose: Windows 预读取数据，用来加快程序启动
- verdict: safe_delete
- confidence: 0.7
- rebuildable: true
- reason: 系统记录的程序启动轨迹，删了会自动重建。流传的「清 Prefetch 提速」其实是误区，清理它主要是为了排除故障或省一点点空间。
- consequence: 删掉后几天内常用程序启动略慢，系统重新学习后恢复；需要管理员权限，且位于系统盘受保护区域。
- revival: autostart_service

## wu-download
- pathRegex: SoftwareDistribution/Download$
- owner: Windows Update
- ownerKind: system
- purpose: Windows 更新已下载安装包的存放目录
- verdict: safe_delete
- confidence: 0.8
- rebuildable: true
- reason: 更新装完后这些安装包就没用了，是微软官方排障文档里认可可清理的目录，常占数 GB。
- consequence: 删掉后若还有未完成的更新会重新下载；规范做法是先停止 Windows Update 服务再清，清完服务会自动重建目录，属正常现象。
- revival: autostart_service

## delivery-optimization
- pathRegex: DeliveryOptimization/Cache$
- owner: Windows
- ownerKind: system
- purpose: 传递优化缓存：给局域网其他电脑分发更新用的本地副本
- verdict: needs_review
- confidence: 0.6
- rebuildable: true
- reason: 内容可再生，但它由系统服务管理，手动删可能与正在进行的更新分发冲突。
- consequence: 建议走「设置 → 存储 → 临时文件」或磁盘清理来清；手动删除后服务会重建目录，正在下载的更新需重来。
- revival: autostart_service

## minidump
- name: Minidump
- pathContains: Windows
- owner: Windows
- ownerKind: system
- purpose: 蓝屏时生成的小型内存转储文件
- verdict: safe_delete
- confidence: 0.85
- rebuildable: false
- reason: 每次蓝屏留一份「事故快照」，供排查驱动问题用；不排查问题时就是纯占位文件。
- consequence: 删除不影响系统运行，只是丢失蓝屏历史证据；最近频繁蓝屏的话建议先留着分析。
- revival: none

## memory-dmp
- glob: MEMORY.DMP
- kind: file
- owner: Windows
- ownerKind: system
- purpose: 蓝屏时的完整内存转储，体积约等于物理内存大小
- verdict: safe_delete
- confidence: 0.85
- rebuildable: false
- reason: 一个文件就可能占 8~32 GB，是磁盘清理的高价值目标；它只是崩溃瞬间的内存快照，系统运行不需要它。
- consequence: 删除后无法再分析那次蓝屏原因，其余无任何影响；可通过磁盘清理安全删除。
- revival: none

## thumb-icon-cache
- glob: thumbcache_*.db|iconcache*.db
- kind: file
- owner: Windows 资源管理器
- ownerKind: system
- purpose: 文件夹缩略图与图标缓存数据库
- verdict: safe_delete
- confidence: 0.85
- rebuildable: true
- reason: 资源管理器把图片/视频预览图存在这里加快浏览，删了会重新生成，也是修复「缩略图显示错乱」的常规手段。
- consequence: 删掉后首次浏览图片文件夹会重新生成预览、稍慢；资源管理器运行时文件被占用，需先结束 explorer 或重启后再删。
- revival: process_lock

## local-crashdumps
- name: CrashDumps
- pathContains: AppData/Local
- owner: Windows 错误报告
- ownerKind: system
- purpose: 应用程序崩溃时生成的转储文件目录
- verdict: safe_delete
- confidence: 0.85
- rebuildable: false
- reason: 各程序崩溃留下的「事故快照」，单个文件可能几百 MB，对普通用户没有保留价值。
- consequence: 删除不影响任何程序运行，仅丢失崩溃排查材料；某个软件反复崩溃时建议先留一份分析。
- revival: none

## recycle-svi
- name: $Recycle.Bin|System Volume Information
- owner: Windows
- ownerKind: system
- purpose: 回收站本体 / 系统还原点与卷影副本存储区
- verdict: keep_locked
- confidence: 0.99
- rebuildable: false
- reason: 回收站里可能还有你等着还原的文件；System Volume Information 存着系统还原点，是系统出问题时救命用的，且受权限保护。
- consequence: 直接删回收站目录等于清空所有可还原文件且绕过确认；删还原点存储会失去系统回退能力并可能报错。清空回收站请用右键「清空回收站」，还原点请用系统保护设置管理。
- revival: driver_protected

## winsxs
- name: WinSxS
- owner: Windows
- ownerKind: system
- purpose: Windows 组件存储，系统文件的「真身」仓库
- verdict: keep_locked
- confidence: 0.99
- rebuildable: false
- reason: 看起来巨大，但里面大量文件是与系统目录共享的硬链接，实际占用远小于显示值；手动删除会直接损坏系统。
- consequence: 手动删除可能导致更新失败、功能损坏甚至无法开机。想瘦身请用管理员命令 Dism /Online /Cleanup-Image /StartComponentCleanup。
- revival: driver_protected

## page-hiber-swap
- glob: pagefile.sys|hiberfil.sys|swapfile.sys
- kind: file
- owner: Windows
- ownerKind: system
- purpose: 虚拟内存页面文件 / 休眠文件 / UWP 应用交换文件
- verdict: keep_locked
- confidence: 0.99
- rebuildable: false
- reason: 都是系统正在使用的核心文件，运行时被内核锁定，直接删除会失败或导致系统异常。
- consequence: 想释放 hiberfil.sys（约等于内存大小）请用管理员命令 powercfg /h off 关闭休眠；pagefile 请在系统高级设置里调整，不要手动删文件。
- revival: process_lock

## windowsapps
- name: WindowsApps
- owner: Windows
- ownerKind: system
- purpose: Microsoft Store 应用（UWP）的安装目录
- verdict: keep_locked
- confidence: 0.9
- rebuildable: false
- reason: 里面是已安装商店应用的程序本体，不是缓存；目录受特殊权限保护，强删会留下损坏的应用注册信息。
- consequence: 删除会导致商店应用无法启动且难以修复；卸载应用请走「设置 → 应用」或开始菜单右键卸载。
- revival: driver_protected

## installer-package-cache
- name: Package Cache|Downloaded Installations
- pathContains: ProgramData
- owner: Visual Studio / 各类安装器
- ownerKind: system
- purpose: 安装器缓存的原始安装包，供修复和卸载时使用
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 删了能省几个 GB，但很多软件（尤其 Visual Studio、VC++ 运行库）修复或卸载时要回读这里的原始包，删了可能卸不干净。
- consequence: 可能导致相关软件无法修复/正常卸载，报「找不到安装源」。Visual Studio 的缓存可用官方 InstallCleanup 工具或 vs_installer 的清理选项处理，不要直接手删。
- revival: missing_uninstaller

## empty-dir
- empty: true
- owner: 通用
- ownerKind: unknown
- purpose: 空目录（不含任何文件和子目录）
- verdict: needs_review
- confidence: 0.5
- rebuildable: true
- reason: 里面什么都没有，删掉不会丢失数据。但空目录不等于无主：软件会预留它当工作区（待写入的日志目录、挂载点），卸载残留也可能只剩一个被注册表登记的空壳。
- consequence: 多数情况删了没影响，软件下次运行可能重新生成缓存。若删掉后又出现，请到「顽固软件诊断」取证，确认具体来源后再处理，不要直接假定存在登记项。
- revival: none