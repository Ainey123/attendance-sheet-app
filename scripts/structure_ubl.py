import json, re

with open('ubl_clean_txs_v2.json', 'r', encoding='utf-8') as f:
    txs = json.load(f)

# Let's inspect how amounts are formatted at the end
# Usually: DEBIT CREDIT BALANCE or CREDIT BALANCE or DEBIT BALANCE
# For example: '... 6,000 0 4,535,391.45' or '... 0 22,196 4,435,652.92'
# Let's write a regex to extract Debit, Credit, Balance

amount_re = re.compile(r'([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$')

for t in txs:
    full_str = ' '.join(t['lines'])
    m = amount_re.search(full_str)
    if m:
        t['debit'] = m.group(1)
        t['credit'] = m.group(2)
        t['balance'] = m.group(3)
        t['particulars'] = full_str[:m.start()].strip()
    else:
        # maybe on last line
        last_line = t['lines'][-1]
        m2 = amount_re.search(last_line)
        if m2:
            t['debit'] = m2.group(1)
            t['credit'] = m2.group(2)
            t['balance'] = m2.group(3)
            # particulars is all lines before plus remainder of last line
            t['particulars'] = (' '.join(t['lines'][:-1]) + ' ' + last_line[:m2.start()]).strip()
        else:
            t['debit'] = ''
            t['credit'] = ''
            t['balance'] = ''
            t['particulars'] = full_str

# Check how many didn't get amounts
missing_amounts = [t for t in txs if not t['debit']]
print(f'Transactions missing amounts: {len(missing_amounts)}')
for m in missing_amounts[:10]:
    print(m)

with open('ubl_structured.json', 'w', encoding='utf-8') as f:
    json.dump(txs, f, indent=2)
