Set-Location -Path $PSScriptRoot\..
docker compose up --build -d
Write-Host "Text editor is running at http://localhost:8080"
