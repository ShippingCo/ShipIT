import assert from 'node:assert/strict';

/** Independent test decoder: quoted delimiters, CRLF and doubled quotes are data. */
export function csvRecords(csv:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<csv.length;i++){
  const c=csv[i]!;
  if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&c===','){row.push(cell);cell='';}
  else if(!quoted&&(c==='\r'||c==='\n')){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 assert.equal(quoted,false,'unterminated CSV cell');
 if(row.length||cell){row.push(cell);rows.push(row);}
 const columns=rows.shift();assert.ok(columns);assert.equal(new Set(columns).size,columns.length);
 return rows.map(values=>{assert.equal(values.length,columns.length,'CSV row width must match its header');return Object.fromEntries(columns.map((column,i)=>[column,values[i]!]));});
}
