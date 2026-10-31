const database = new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('anchorshot-projects',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('records');
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
export async function loadLocal<T>(key:string):Promise<T|undefined>{const db=await database;return new Promise((resolve,reject)=>{const request=db.transaction('records').objectStore('records').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveLocal(key:string,value:unknown){const db=await database;return new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Local save aborted'));});}
