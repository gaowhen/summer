title: "Illegal System DLL Relocation"
date: 2007-06-06 10:02:33
tags:
id: 111
categories:
  - 经验技巧
---

昨天安装ServerU以架设Ftp时，安装过程中出现系统错误

<font color="Red">The system DLL user32.dll was relocated in memory. The application will not run properly. The relocation occurred because the DLL C:\Windows\System32\Hhctrl.ocx occupied an address range reserved for Windows system DLLs. The vendor supplying the DLL should be contacted for a new DLL.</font>

![](/images/)

原因：
    This problem may occur after you install security update 925902 (MS07-017) and security update 928843 (MS07-008). The Hhctrl.ocx file that is included in security update 928843 and the User32.dll file that is included in security update 925902 have conflicting base addresses. This problem occurs if the program loads the Hhctrl.ocx file before it loads the User32.dll file.

是由于安装了微软的安全更新925902 (MS07-017)和928843 (MS07-008)，以下略。。。

解决：
    下载这个更新程序安装：[935448](http://www.microsoft.com/downloads/details.aspx?FamilyId=74AD4188-3131-429C-8FCB-F7B3B0FD3D86)