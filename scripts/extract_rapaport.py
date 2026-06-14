import pdfplumber
import json
import sys
import re

pdf = pdfplumber.open(sys.argv[1])
colors = ['D','E','F','G','H','I','J','K','L','M']
clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3']

result = {
    '.90-.99': {}, '1.00-1.49': {}, '1.50-1.99': {}, '2.00-2.99': {},
    '3.00-3.99': {}, '4.00-4.99': {}, '5.00-5.99': {}, '10.00-10.99': {}
}

# Extract date from first page
first_page_text = pdf.pages[0].extract_text() or ""
# Match "February 13, 2026" or "February13,2026"
date_match = re.search(r'([A-Za-z]+)\s*(\d{1,2}),\s*(\d{4})', first_page_text)
if date_match:
    month_str = date_match.group(1)
    day = date_match.group(2)
    year = date_match.group(3)[-2:]
    month_map = {'January': '01', 'February': '02', 'March': '03', 'April': '04',
                 'May': '05', 'June': '06', 'July': '07', 'August': '08',
                 'September': '09', 'October': '10', 'November': '11', 'December': '12'}
    month = month_map.get(month_str, '01')
    date_str = f"{month}/{day.zfill(2)}/{year}"
else:
    date_str = "Unknown"

def find_tables():
    ranges = []
    for pi, page in enumerate(pdf.pages):
        lines = page.extract_text().split('\n')
        for i, line in enumerate(lines):
            if '(.90 - .99' in line and '1.00 - 1.49' in line:
                ranges.append({'page': pi, 'start': i+1, 'end': i+12, 'left': '.90-.99', 'right': '1.00-1.49'})
            if '(1.50 - 1.99' in line and '(2.00 - 2.99' in line:
                ranges.append({'page': pi, 'start': i+1, 'end': i+12, 'left': '1.50-1.99', 'right': '2.00-2.99'})
            if '(3.00 - 3.99' in line and '(4.00 - 4.99' in line:
                ranges.append({'page': pi, 'start': i+1, 'end': i+12, 'left': '3.00-3.99', 'right': '4.00-4.99'})
            if '(5.00 - 5.99' in line and '(10.00' in line:
                ranges.append({'page': pi, 'start': i+1, 'end': i+12, 'left': '5.00-5.99', 'right': '10.00-10.99'})
    return ranges

for rng in find_tables():
    page = pdf.pages[rng['page']]
    lines = page.extract_text().split('\n')
    
    for i in range(rng['start'], min(rng['end'], len(lines))):
        line = lines[i]
        parts = line.split()
        if len(parts) < 25: continue
        
        color = parts[0]
        if color not in colors: continue
        
        if rng['left'] not in result: result[rng['left']] = {}
        if color not in result[rng['left']]: result[rng['left']][color] = {}
        for c_idx, cl in enumerate(clarities):
            try:
                result[rng['left']][color][cl] = int(parts[1 + c_idx])
            except:
                pass
        
        if rng['right'] not in result: result[rng['right']] = {}
        if color not in result[rng['right']]: result[rng['right']][color] = {}
        for c_idx, cl in enumerate(clarities):
            try:
                result[rng['right']][color][cl] = int(parts[13 + c_idx])
            except:
                pass

# Output both date and data
output = {"date": date_str, "data": result}
print(json.dumps(output))
