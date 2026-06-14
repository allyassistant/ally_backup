import pdfplumber
import re

pdf_path = "/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf"

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        if "4.00" in text and "4.99" in text:
            print(f"Page {page_num} - Full table dump:")
            print("=" * 80)
            
            lines = text.split('\n')
            
            in_section = False
            for line in lines:
                if "4.00" in line and "4.99" in line:
                    in_section = True
                    print(f"\n{line}")
                    continue
                    
                if "5.00" in line and "5.99" in line:
                    print(f"\n{line}")
                    break
                    
                if in_section and line.strip():
                    # Look for color rows
                    if re.match(r'^[D-M]\s', line.strip()):
                        print(line)
            break

print("\n" + "=" * 80)
print("Looking for ALL F rows...")

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        if "4.00" in text and "4.99" in text:
            lines = text.split('\n')
            
            in_section = False
            for line in lines:
                if "4.00" in line and "4.99" in line:
                    in_section = True
                    continue
                if "5.00" in line and "5.99" in line:
                    break
                    
                if in_section and line.strip().startswith('F ') and re.search(r'\d', line):
                    numbers = re.findall(r'\d+', line)
                    print(f"\nF row: {line}")
                    print(f"Numbers: {numbers[:11]}")
                    if len(numbers) >= 6:
                        si1 = numbers[5]
                        print(f"  -> SI1 = {si1}")
            break
