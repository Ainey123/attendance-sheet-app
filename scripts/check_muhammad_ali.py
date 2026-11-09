import json

with open('ubl_clean_txs.json', 'r', encoding='utf-8') as f:
    ubl_txs = json.load(f)

print('=== ALL MUHAMMAD ALI TRANSACTIONS IN UBL ===')
for idx, tx in enumerate(ubl_txs):
    txt = ' '.join(tx['lines'])
    if 'muhammad ali' in txt.lower():
        print(f'UBL #{idx+1} [P{tx["page"]}]: {txt}')

print('\n=== ALL FES / VEHARI TRANSACTIONS ===')
for idx, tx in enumerate(ubl_txs):
    txt = ' '.join(tx['lines'])
    if 'fes' in txt.lower() or 'vehari' in txt.lower() or 'veha' in txt.lower():
        print(f'UBL #{idx+1} [P{tx["page"]}]: {txt}')
