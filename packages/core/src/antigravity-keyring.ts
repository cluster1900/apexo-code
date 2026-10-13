// Read only agy's generic credential. The native CLI owns writes, refresh, and logout.
export const windowsCredential = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AgyCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public uint Flags, Type;
    public string TargetName, Comment;
    public long LastWritten;
    public uint BlobSize;
    public IntPtr Blob;
    public uint Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredFree")]
  public static extern void Free(IntPtr credential);
}
'@
$pointer = [IntPtr]::Zero
if (-not [AgyCredential]::Read('gemini:antigravity', 1, 0, [ref]$pointer)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 44 }
  exit 1
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][AgyCredential+Credential])
  $bytes = New-Object byte[] $credential.BlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.Blob, $bytes, 0, $bytes.Length)
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  [Console]::Write([Text.Encoding]::UTF8.GetString($bytes))
} finally { [AgyCredential]::Free($pointer) }
`
