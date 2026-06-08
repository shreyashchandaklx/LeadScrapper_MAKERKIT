
# GitHub Push & Troubleshooting Commands

This file documents the commands used to migrate the **LeadScrapper_MAKERKIT** project to GitHub and resolve security/permission issues.

## 1. Setting up the Remote
If your project is pointing to the wrong account or repository, use these:

```bash
# Update the remote URL to the new repository
git remote set-url origin https://github.com/shreyashchandaklx/LeadScrapper_MAKERKIT.git

# Ensure you are on the main branch
git branch -M main
```

## 2. Resolving "Push Protection" (Secret Scanning)
If GitHub blocks your push because of an API key or password found in a file (like `settings.json` or `.env`):

### A. Remove the file from tracking
```bash
# Removes the file from Git but keeps it on your computer
git rm --cached settings.json
```

### B. Ignore the file
Add the filename to your `.gitignore` so it isn't added again:
```bash
echo "settings.json" >> .gitignore
echo ".env" >> .gitignore
```

### C. Clean the History (Mandatory)
If the secret was in an old commit, deleting the file isn't enough. You must reset or rebase:
```bash
# Reset to the last 'clean' commit (replace [ID] with your last good commit hash)
git reset --soft [ID]

# Re-commit the clean files
git add .
git commit -m "Initial commit (cleaned of secrets)"
```

## 3. Uploading the 'dist' Folder
The `dist` folder is usually ignored. To force upload it while staying secure:

```bash
# 1. Delete any .env or secret files inside dist/
rm dist/.env

# 2. Add dist/.env to .gitignore just in case
echo "dist/.env" >> .gitignore

# 3. Force add the dist folder (ignores .gitignore rules)
git add -f dist

# 4. Commit and push
git commit -m "chore: upload build files"
git push origin main
```

## 4. Common Troubleshooting
- **403 Forbidden**: Check your Windows Credential Manager or use a Personal Access Token (PAT).
- **Remote Rejected**: Usually means a "Push Protection" rule was violated (check terminal output for a URL to 'unblock' the secret).
- **Nothing to commit**: You haven't staged any changes with `git add .`.
