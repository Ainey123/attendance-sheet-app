import json

with open('ubl_structured.json', 'r', encoding='utf-8') as f:
    ubl = json.load(f)

with open('alfalah_structured.json', 'r', encoding='utf-8') as f:
    alf = json.load(f)

def clean_amt(s):
    if not s:
        return 0.0
    return float(str(s).replace(',', '').strip())

# Build the structured dataset of employee credits
# 1. Ali Shehzad
# 2. Muhammad Ibrahim
# 3. Muhammad Danish Ali (requested as: muhammad daish as danish ali)
# 4. Muhammad Ali (requested as: muhammad ali as fes ali vehari)
#    and FES Faisal Elec Vehari
# 5. Rehman Ali
# 6. Abaid Ullah (Ubaid Ullah)
# 7. Muhammad Asif
# 8. Asif Rasheed
# 9. Wajahat Afzal (Muhammad Wajahat Afz)
# 10. Muhammad Faisal (FES Faisal Elec Vehari / Faisal Shehzad)
# 11. Asjad (0 transactions found)

results = {}

# 1. Ali Shehzad
results['Ali Shehzad'] = []
for t in ubl:
    p = t['particulars']
    if 'ali shahzad' in p.lower() or 'ali shehzad' in p.lower():
        results['Ali Shehzad'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'JazzCash PK48JCMA*********250',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 2. Muhammad Ibrahim
results['Muhammad Ibrahim'] = []
for t in alf:
    p = t['particulars']
    if 'ibrahim' in p.lower():
        results['Muhammad Ibrahim'].append({
            'date': t['date'],
            'bank': 'Bank Alfalah',
            'channel': 'IBFT',
            'account': 'Meezan Bank 11640113815198 (Asaan A/C)',
            'amount': clean_amt(t['amt1']),
            'description': p
        })

# 3. Muhammad Danish Ali (Danish Ali)
results['Muhammad Danish Ali (Danish Ali)'] = []
for t in ubl:
    p = t['particulars']
    if 'danish ali' in p.lower():
        results['Muhammad Danish Ali (Danish Ali)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'Easypaisa PK33TMFB*********452',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 4. Muhammad Ali
results['Muhammad Ali'] = []
for t in ubl:
    p = t['particulars']
    if 'to muhammad ali' in p.lower() or 'to: muhammad ali' in p.lower():
        ch = 'Digital App IBFT' if 'digital app' in p.lower() else 'RAAST P2P FT'
        acct = 'Mobilink Microfinance Bank' if 'mobilink' in p.lower() else 'JazzCash PK62JCMA*********807'
        results['Muhammad Ali'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': ch,
            'account': acct,
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 4b / 10. FES Faisal Elec Vehari (fes ali vehari / Muhammad Faisal)
results['FES Faisal Elec Vehari (FES Ali Vehari / Muhammad Faisal)'] = []
for t in ubl:
    p = t['particulars']
    if 'fes faisal elec veha' in p.lower():
        results['FES Faisal Elec Vehari (FES Ali Vehari / Muhammad Faisal)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'JazzCash PK19JCMA*********145',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# Faisal Shehzad (additional note for Muhammad Faisal)
results['Faisal Shehzad'] = []
for t in ubl:
    p = t['particulars']
    if 'faisal shehzad' in p.lower():
        results['Faisal Shehzad'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'JazzCash PK82JCMA*********137',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 5. Rehman Ali
results['Rehman Ali'] = []
for t in ubl:
    p = t['particulars']
    if 'transfer to rehman ali' in p.lower():
        results['Rehman Ali'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'Digital App Internal Transfer',
            'account': 'UBL A/C 0003****9374',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# Ali Rehman (for transparency)
results['Ali Rehman (Separate Account)'] = []
for t in ubl:
    p = t['particulars']
    if 'to ali rehman' in p.lower():
        results['Ali Rehman (Separate Account)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'Meezan Bank PK16MEZN*********937',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 6. Abaid Ullah (Ubaid Ullah)
results['Abaid Ullah (Ubaid Ullah)'] = []
for t in ubl:
    p = t['particulars']
    if 'ubaid ullah' in p.lower() or 'abaid ullah' in p.lower():
        results['Abaid Ullah (Ubaid Ullah)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'Easypaisa PK22TMFB*********337',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 7. Muhammad Asif
results['Muhammad Asif'] = []
for t in alf:
    p = t['particulars']
    if 'to muhammad asif' in p.lower():
        results['Muhammad Asif'].append({
            'date': t['date'],
            'bank': 'Bank Alfalah',
            'channel': 'IBFT',
            'account': 'Easypaisa / Telenor Microfinance Bank 03104626317',
            'amount': clean_amt(t['amt1']),
            'description': p
        })
for t in ubl:
    p = t['particulars']
    if 'to muhammad asif' in p.lower():
        # check account
        acct = 'Easypaisa PK63TMFB*********454' if '454' in p else 'Easypaisa PK80TMFB*********494'
        results['Muhammad Asif'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': acct,
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 8. Asif Rasheed
results['Asif Rasheed'] = []
for t in ubl:
    p = t['particulars']
    if 'asif rasheed' in p.lower() or 'asif rashid' in p.lower():
        results['Asif Rasheed'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': 'JazzCash PK43JCMA*********935',
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 9. Wajahat Afzal (Muhammad Wajahat Afz)
results['Wajahat Afzal (Muhammad Wajahat Afz)'] = []
for t in ubl:
    p = t['particulars']
    if 'wajahat afz' in p.lower():
        acct = 'Easypaisa PK29TMFB*********710' if 'easypaisa' in p.lower() else 'JazzCash PK15JCMA*********531'
        results['Wajahat Afzal (Muhammad Wajahat Afz)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': acct,
            'amount': clean_amt(t['debit']),
            'description': p
        })

# Muhammad Afzal (for transparency)
results['Muhammad Afzal (Separate Account)'] = []
for t in ubl:
    p = t['particulars']
    if 'to muhammad afzal' in p.lower():
        acct = 'Easypaisa PK66TMFB*********214' if 'easypaisa' in p.lower() else 'JazzCash PK40JCMA*********926'
        results['Muhammad Afzal (Separate Account)'].append({
            'date': t['date'],
            'bank': 'UBL',
            'channel': 'RAAST P2P FT',
            'account': acct,
            'amount': clean_amt(t['debit']),
            'description': p
        })

# 11. Asjad
results['Asjad'] = []

print("=== SUMMARY OF EXTRACTED TRANSACTIONS ===")
grand_total = 0.0
for emp, tx_list in results.items():
    subtotal = sum(item['amount'] for item in tx_list)
    print(f"\n{emp}: {len(tx_list)} transactions, Subtotal: PKR {subtotal:,.2f}")
    for it in tx_list:
        print(f"  {it['date']} | {it['bank']} | PKR {it['amount']:>10,.2f} | {it['account']} | {it['channel']}")

with open('employee_october_data.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
