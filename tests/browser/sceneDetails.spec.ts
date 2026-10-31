import {test,expect} from '@playwright/test';
test('scene details edits persist without replacing image',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Kitchen to ocean',exact:true}).click();await page.getByRole('button',{name:'Apply direction',exact:true}).click();const panel=page.getByRole('complementary',{name:'Selected scene details'});await panel.waitFor();
 const before=await page.getByRole('region',{name:'Film preview'}).locator('.preview-frame img').first().getAttribute('src');
 await panel.getByLabel('Prompt',{exact:true}).fill('A quiet ocean beyond the kitchen door.');await panel.getByLabel('Duration').fill('5');await panel.getByRole('button',{name:'Save changes'}).click();await expect(panel.getByRole('status')).toHaveText('Changes saved');await expect(page.locator('.local-label')).toContainText('Saved locally');
 expect(await page.getByRole('region',{name:'Film preview'}).locator('.preview-frame img').first().getAttribute('src')).toBe(before);
 await page.reload();await expect(panel.getByLabel('Prompt',{exact:true})).toHaveValue('A quiet ocean beyond the kitchen door.');await expect(panel.getByLabel('Duration')).toHaveValue('5');await panel.getByLabel('Duration').fill('0');await expect(panel.getByRole('button',{name:'Save changes'})).toBeDisabled();
});
