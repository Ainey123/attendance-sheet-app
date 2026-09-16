const fs = require('fs');
let code = fs.readFileSync('db.js', 'utf8');

const oldLoop = `        for (let i = 0; i < list.length; i++) {
          if (!list[i].token || list[i].token.startsWith('EXPIRED_')) {
            list[i].token = generateToken();
            try {
              await supabase.from('employees').update({ token: list[i].token }).eq('id', list[i].id);
            } catch(e) {}
          }
          list[i] = await this.checkAndUpdateLinkCycle(list[i]);
        }`;

const newLoop = `        await Promise.all(list.map(async (emp, i) => {
          if (!emp.token || emp.token.startsWith('EXPIRED_')) {
            emp.token = generateToken();
            try {
              await supabase.from('employees').update({ token: emp.token }).eq('id', emp.id);
            } catch(e) {}
          }
          list[i] = await this.checkAndUpdateLinkCycle(emp);
        }));`;

code = code.replace(oldLoop, newLoop);
fs.writeFileSync('db.js', code);
console.log('Parallelized getEmployees loop!');
