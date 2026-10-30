import {test,expect} from '@playwright/test';
test('animated tour navigates all steps, pauses, closes and leaves project untouched',async({page})=>{
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});await page.goto('/');
 const transcript=page.getByRole('textbox',{name:'Scene Transcript',exact:false});const before=await transcript.inputValue();
 await page.getByRole('button',{name:'UI tour',exact:true}).click();const tour=page.getByRole('dialog');await expect(tour).toBeVisible();await expect(tour.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
 await expect(tour.getByTestId('tour-preview')).toHaveAttribute('data-motion','playing');
 const ocean=tour.locator('img').nth(1);const first=await ocean.evaluate(e=>getComputedStyle(e).opacity);await page.waitForTimeout(450);expect(await ocean.evaluate(e=>getComputedStyle(e).opacity)).not.toBe(first);
 await tour.getByRole('button',{name:'Pause animation'}).click();await expect(tour.getByTestId('tour-preview')).toHaveAttribute('data-motion','paused');
 const paused=await ocean.evaluate(e=>getComputedStyle(e).opacity);await page.waitForTimeout(250);expect(await ocean.evaluate(e=>getComputedStyle(e).opacity)).toBe(paused);
 await tour.getByRole('button',{name:'Resume animation'}).click();
 for(const title of ['Describe the dream','Select your cup','Add the umbrella','Correct each mask','Watch the world change','Check, then export']){await tour.getByRole('button',{name:'Next',exact:true}).click();await expect(tour.getByRole('heading',{name:title,exact:true})).toBeVisible();}
 await tour.getByRole('button',{name:'Back',exact:true}).click();await expect(tour.getByRole('heading',{name:'Watch the world change'})).toBeVisible();await tour.getByRole('button',{name:'Next',exact:true}).click();await expect(tour.getByRole('heading',{name:'Check, then export'})).toBeVisible();
 await tour.screenshot({path:'.artifacts/tour/desktop.png'});await tour.getByRole('button',{name:'Finish tour'}).click();await expect(tour).not.toBeVisible();await expect(page.getByRole('button',{name:'UI tour',exact:true})).toBeFocused();
 expect(await transcript.inputValue()).toBe(before);expect(posts).toEqual([]);
 await page.getByRole('button',{name:'UI tour',exact:true}).click();await expect(tour.getByRole('heading',{name:'Your dream, with familiar anchors'})).toBeVisible();await page.keyboard.press('Escape');await expect(tour).not.toBeVisible();
});
test('tour supports mobile, reduced motion and modal keyboard containment',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.getByRole('button',{name:'UI tour',exact:true}).click();const tour=page.getByRole('dialog');
 await expect(tour.getByTestId('tour-preview')).toHaveAttribute('data-motion','paused');await expect(tour.getByRole('button',{name:'Reduced motion'})).toBeDisabled();
 for(let i=0;i<10;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
 await page.keyboard.press('y');await page.keyboard.press('g');await page.keyboard.press('?');await expect(page.getByRole('dialog')).toHaveCount(1);
 expect(await tour.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await tour.screenshot({path:'.artifacts/tour/mobile.png'});
 await tour.getByRole('button',{name:'Skip tour'}).click();await expect(tour).not.toBeVisible();
});
