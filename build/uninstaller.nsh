!macro customUnInstall
  ; 卸载前强制结束程序进程，防止文件被占用
  ExecWait 'taskkill /f /im 拾词.exe' $R0

  ; 删除运行时生成的数据和缓存（发音文件保留，确保重新安装后仍能快速调用）
  RMDir /r "$INSTDIR\resources\cache"
  Delete "$INSTDIR\resources\wordbooks.json"
!macroend
