# Explicit setup only; routine index/search never fetches upstream changes.
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$cacheRoot=Join-Path (Split-Path $projectRoot -Parent) 'AnchorShot-reference-coding'
$references=Get-Content (Join-Path $projectRoot 'docs/reference-repositories.json') -Raw | ConvertFrom-Json
foreach($reference in $references){
 $checkout=Join-Path $cacheRoot ('repos/'+$reference.name)
 if(!(Test-Path -LiteralPath $checkout)){
  git clone --depth 1 --filter=blob:none --sparse --no-checkout ($reference.repository+'.git') $checkout
  if($LASTEXITCODE -ne 0){throw 'Clone failed'}
  git -C $checkout fetch --depth 1 origin $reference.commit
  if($LASTEXITCODE -ne 0){throw 'Pinned commit fetch failed'}
  git -C $checkout checkout --detach $reference.commit
  if($LASTEXITCODE -ne 0){throw 'Checkout failed'}
  git -C $checkout sparse-checkout set @($reference.paths)
  if($LASTEXITCODE -ne 0){throw 'Sparse checkout failed'}
 }
 $actual=git -C $checkout rev-parse HEAD
 if($LASTEXITCODE -ne 0 -or $actual -ne $reference.commit){throw "Unexpected pin in $checkout. Leaving checkout untouched."}
 if(!(Test-Path -LiteralPath (Join-Path $checkout '.xerjignore'))){
  @('*.json','*.yaml','*.yml','*.lock','*.svg','*.mp4','*.webm','*.ipynb','*.bin','*.map','*.pt','*.pth','*.safetensors','*.onnx','*.zip','*.png','*.jpg','*.webp','*.jpeg','*.gif','*.woff','*.woff2','*.ttf','*.ico') | Set-Content (Join-Path $checkout '.xerjignore')
 }
 Write-Output "$($reference.name): $actual"
}
