import pdfplumber
import re

pdf_path = "/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf"

with pdfplumber.open(pdf_path) as pdf:
    print(f"PDF has {len(pdf.pages)} pages\n")
    
    # Find all tables and their ranges
    tables = []
    
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        lines = text.split('\n')
        
        for line in lines:
            # Look for table headers like "(5.00 - 5.99 CT.)"
            match = re.search(r'\(\s*(\d+\.\d+)\s*-\s*(\d+\.\d+)\s*CT\s*\.\s*\)', line)
            if match and 'RAPAPORT' in line:
                range_name = f"{match.group(1)}-{match.group(2)}"
                tables.append({
                    'page': page_num,
                    'range': range_name,
                    'line': line.strip()
                })
    
    print("Tables found in Pear PDF:")
    print("=" * 60)
    for t in tables:
        print(f"  {t['range']} (Page {t['page']})")
    
    # Extract 5.00-5.99 as sample
    print("\n" + "=" * 60)
    print("Sample: 5.00-5.99 Pear D color:")
    print("=" * 60)
    
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        if "5.00" in text and "5.99" in text:
            lines = text.split('\n')
            
            in_section = False
            for line in lines:
                if "5.00" in line and "5.99" in line:
                    in_section = True
                    continue
                if in_section and line.strip().startswith('D ') and re.search(r'\d', line):
                    numbers = re.findall(r'\d+', line)
                    print(f"\nD row: {line}")
                    print(f"Numbers: {numbers[:11]}")
                    
                    clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3']
                    print("\nPear 5.00-5.99 D color values:")
                    for c, v in zip(clarities, numbers[:11]):
                        print(f"  {c}: {v}")
                    break
            break

print("\n" + "=" * 60)
print("PEAR vs ROUND comparison (5.00-5.99 D VVS1):")
print("=" * 60)
print("  Pear: ~630 (from earlier extraction)")
print("  Round: 855")
print("  Difference: Pear is ~26% lower than Round")
