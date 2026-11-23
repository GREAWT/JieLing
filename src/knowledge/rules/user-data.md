# 用户有价值数据保护规则

## user-shell-folders
- name: Documents|Desktop|Pictures|Videos|Music|Favorites|Contacts|Links|Saved Games|Searches
- pathRegex: /Users/[^/]+/[^/]+$
- owner: 用户个人文件夹
- ownerKind: system
- purpose: Windows 用户库文件夹：文档、桌面、图片、视频、音乐、游戏存档等
- verdict: keep_locked
- confidence: 0.95
- rebuildable: false
- reason: 这是系统为你保管个人资料的「主仓库」，里面是你的文档、照片、存档，不是任何软件的缓存。
- consequence: 删除等于直接丢个人资料，且很多软件（截图工具、游戏、办公软件）默认往这里写文件，删了还会出各种异常。请整体保留，清理应深入到具体文件逐个判断。
- revival: none

## downloads-folder
- name: Downloads|下载
- pathRegex: /Users/[^/]+/
- owner: 用户个人文件夹
- ownerKind: system
- purpose: 浏览器与各类软件的默认下载目录
- verdict: needs_review
- confidence: 0.85
- rebuildable: false
- reason: 典型的「垃圾与宝贝混装」：看完的安装包、临时压缩包可以删，但下载的合同、发票、素材可能只此一份。
- consequence: 整体删除会误伤重要下载文件。建议按类型/时间甄别：安装包和临时文件优先清理，文档类先打开确认或移入文档目录。
- revival: none

## ssh-gnupg-dir
- name: .ssh|.gnupg
- owner: 用户密钥数据
- ownerKind: unknown
- purpose: SSH 私钥 / GPG 密钥与信任数据库
- verdict: keep_locked
- confidence: 0.97
- rebuildable: false
- reason: 这里是你登录服务器、签名代码、解密文件的身份凭证，体积极小但价值极高，丢了基本无法补办。
- consequence: 删除后无法再登录依赖该密钥的服务器/Git 仓库，加密数据可能永久打不开。绝对保留，并建议另行备份。
- revival: none

## key-cert-files
- glob: *.pem|*.key|*.p12|*.pfx|*.kdbx|*.jks|id_rsa|id_ed25519|*.keystore
- kind: file
- owner: 用户密钥数据
- ownerKind: unknown
- purpose: 私钥、证书、密码库文件（KeePass/Java KeyStore 等）
- verdict: keep_locked
- confidence: 0.9
- rebuildable: false
- reason: 扩展名表明这是密钥或证书类文件：可能是服务器私钥、网站证书、密码保险库，任何一个都不可替代。
- consequence: 删除可能导致服务器无法登录、HTTPS 服务中断、密码库永久锁死。无论多小都请保留。
- revival: none

## database-files
- glob: *.mdf|*.ldf|*.sqlite|*.sqlite3|*.mdb|*.accdb|*.dbf|*.ibd
- kind: file
- owner: 用户数据文件
- ownerKind: unknown
- purpose: 数据库数据文件（SQL Server/SQLite/Access/MySQL 等）
- verdict: keep_locked
- confidence: 0.85
- rebuildable: false
- reason: 这些是某个软件或项目的真实数据仓库：账目、聊天记录、业务数据都可能躺在里面，不是缓存。
- consequence: 删除等于删库，依赖它的软件会报错或数据清零，且通常无法重建。请先确认归属软件并备份。
- revival: none

## env-secret-files
- glob: .env|.env.*
- kind: file
- owner: 项目配置数据
- ownerKind: dev_tool
- purpose: 项目环境变量文件，常含数据库密码、API 密钥
- verdict: keep_locked
- confidence: 0.85
- rebuildable: false
- reason: .env 里一般写着项目运行必需的密钥和连接串，通常不进版本库，删了就没有第二份。
- consequence: 删除后项目跑不起来，且需要重新找齐所有密钥配置，非常折腾。请保留。
- revival: none

## mail-archives
- glob: *.pst|*.ost
- kind: file
- owner: Outlook
- ownerKind: app
- purpose: Outlook 邮件存档/离线数据文件
- verdict: keep_locked
- confidence: 0.9
- rebuildable: false
- reason: 多年邮件、联系人、日历可能全在这一个文件里，pst 尤其常是本地唯一存档。
- consequence: 删除后邮件历史丢失；ost 理论上可从服务器重建，但 pst 往往不可再生。请保留并建议备份。
- revival: none

## vm-disk-files
- glob: *.vmdk|*.vhd|*.vhdx|*.qcow2|*.vdi
- kind: file
- owner: 虚拟机软件
- ownerKind: app
- purpose: 虚拟机磁盘镜像，里面是一整台虚拟电脑
- verdict: keep_locked
- confidence: 0.9
- rebuildable: false
- reason: 一个文件就是一套完整系统加数据，体积大但属于高价值资产，不是缓存。
- consequence: 删除后虚拟机及其中的所有数据、环境配置全部消失，重建成本极高。确认不再需要前请保留。
- revival: none

## project-source-files
- glob: *.psd|*.prproj|*.aep|*.blend|*.unity|*.uproject|*.sln
- kind: file
- owner: 用户创作工程
- ownerKind: unknown
- purpose: 设计/剪辑/3D/游戏/代码工程的源文件
- verdict: keep_locked
- confidence: 0.75
- rebuildable: false
- reason: 扩展名表明这是创作工程的「源稿」：PSD 分层稿、剪辑工程、3D 场景等，导出成品可以再生，源稿丢了就没了。
- consequence: 删除后无法再修改对应作品，只能对着成品重做。请保留；大体积素材缓存应另行甄别。
- revival: none

## finance-docs
- glob: *账单*|*发票*|*合同*|*工资*|*财务报表*
- kind: any
- owner: 用户重要文档
- ownerKind: unknown
- purpose: 文件名含财务/法务关键词的文档
- verdict: keep_locked
- confidence: 0.6
- rebuildable: false
- reason: 文件名看起来是账单、发票、合同这类报销和维权要用的材料，宁可多留不可误删；当然也可能只是重名的普通文件。
- consequence: 误删可能影响报销、对账或法律举证。建议打开确认内容后自行归档，清理工具不应自动处理这类文件。
- revival: none

## backup-dirs
- glob: *backup*|*备份*
- kind: directory
- owner: 用户/软件备份
- ownerKind: unknown
- purpose: 名称表明是备份用途的目录
- verdict: needs_review
- confidence: 0.6
- rebuildable: false
- reason: 备份是数据的最后一道保险，可能是手机备份、数据库 dump 或软件自动备份；旧备份可清，但要先确认有更新的副本。
- consequence: 删掉唯一备份后，一旦原数据出事就彻底无法恢复。请按时间保留最近一份，确认冗余后再清理旧备份。
- revival: none