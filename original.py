import time
import csv
import getpass
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup

# Configuración
GROUP_URL = "https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub"
LOGIN_URL = "https://www.steamgifts.com/login"

# Configuración de Selenium
chrome_options = Options()
chrome_options.add_argument("--headless")  # Sin interfaz gráfica
chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

# Función para iniciar sesión
def login(driver, username, password):
    driver.get(LOGIN_URL)
    time.sleep(2)
    driver.find_element(By.NAME, "username").send_keys(username)
    driver.find_element(By.NAME, "password").send_keys(password)
    driver.find_element(By.NAME, "login").click()
    time.sleep(3)  # Esperar redirección

# Función para obtener la lista de miembros
def get_members(driver):
    driver.get(GROUP_URL + "/users")
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, "html.parser")
    members = []
    for member in soup.find_all("a", class_="table__column__heading"):
        username = member.text.strip()
        profile_url = "https://www.steamgifts.com" + member["href"]
        members.append({"username": username, "profile_url": profile_url})
    return members

# Función para obtener sorteos del grupo
def get_group_giveaways(driver):
    driver.get(GROUP_URL)
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, "html.parser")
    giveaways = []
    for giveaway in soup.find_all("div", class_="table__row-inner-wrap"):
        title = giveaway.find("a", class_="table__column__heading").text.strip()
        link = "https://www.steamgifts.com" + giveaway.find("a", class_="table__column__heading")["href"]
        creator = giveaway.find("a", class_="table__column--width-fill").text.strip()
        end_date = giveaway.find("div", class_="table__column--width-small text-center").text.strip()
        level = giveaway.find("span", class_="table__column--guest-level")
        level = level.text.strip() if level else "No level restriction"
        region = giveaway.find("span", class_="table__column--guest-region")
        region = region.text.strip() if region else "No region restriction"
        copies = giveaway.find("div", class_="table__column--width-small text-center", string=lambda x: "Copies" in x if x else False)
        copies = copies.text.strip() if copies else "1 copy"
        entries = giveaway.find("div", class_="table__column--width-small text-center", string=lambda x: "Entries" in x if x else False)
        entries = entries.text.strip() if entries else "0 entries"
        giveaways.append({
            "title": title,
            "link": link,
            "creator": creator,
            "end_date": end_date,
            "level": level,
            "region": region,
            "copies": copies,
            "entries": entries
        })
    return giveaways

# Función para obtener victorias en sorteos del grupo
def get_member_wins(driver, profile_url, group_giveaway_links):
    driver.get(profile_url + "/giveaways/won")
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, "html.parser")
    wins = 0
    for win in soup.find_all("a", class_="table__column__heading"):
        win_link = "https://www.steamgifts.com" + win["href"]
        if win_link in group_giveaway_links:
            wins += 1
    return wins

# Función para obtener comentarios en el grupo
def get_member_comments(driver, username):
    driver.get(GROUP_URL + "/discussion")
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, "html.parser")
    comments = soup.find_all("div", class_="comment__username")
    comment_count = sum(1 for comment in comments if comment.find("a").text.strip() == username)
    return comment_count

# Función para guardar y permitir edición manual
def save_to_csv(data, filename, fieldnames):
    with open(filename, "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for item in data:
            writer.writerow(item)

# Función principal
def main():
    # Solicitar credenciales
    print("Ingresa tus credenciales de SteamGifts (no se almacenarán):")
    username = input("Usuario: ")
    password = getpass.getpass("Contraseña: ")

    # Iniciar Selenium
    driver = webdriver.Chrome(options=chrome_options)
    try:
        # Iniciar sesión
        login(driver, username, password)

        # Obtener sorteos del grupo
        group_giveaways = get_group_giveaways(driver)
        group_giveaway_links = {g["link"] for g in group_giveaways}

        # Obtener miembros
        members = get_members(driver)
        member_stats = []

        # Procesar cada miembro
        for member in members:
            print(f"Procesando {member['username']}...")
            created = sum(1 for g in group_giveaways if g["creator"] == member["username"])
            wins = get_member_wins(driver, member["profile_url"], group_giveaway_links)
            comments = get_member_comments(driver, member["username"])
            member_stats.append({
                "username": member["username"],
                "created_giveaways": created,
                "won_giveaways": wins,
                "comments": comments,
                "played_wins": ""  # Columna editable para victorias jugadas
            })
            time.sleep(1)  # Evitar bloqueos

        # Guardar estadísticas de miembros
        member_fieldnames = ["username", "created_giveaways", "won_giveaways", "comments", "played_wins"]
        save_to_csv(member_stats, "member_stats.csv", member_fieldnames)

        # Guardar sorteos
        giveaway_fieldnames = ["title", "link", "creator", "end_date", "level", "region", "copies", "entries"]
        save_to_csv(group_giveaways, "giveaways.csv", giveaway_fieldnames)

        # Mostrar resultados en consola
        print("\n=== Estadísticas de Miembros ===")
        for stat in member_stats:
            print(f"Usuario: {stat['username']}")
            print(f"  Sorteos creados: {stat['created_giveaways']}")
            print(f"  Sorteos ganados: {stat['won_giveaways']}")
            print(f"  Comentarios: {stat['comments']}")
            print(f"  Victorias jugadas: {stat['played_wins'] or 'No especificado'}")
            print()

        print("\n=== Sorteos Activos ===")
        for giveaway in group_giveaways:
            print(f"Juego: {giveaway['title']}")
            print(f"  Creador: {giveaway['creator']}")
            print(f"  Fin: {giveaway['end_date']}")
            print(f"  Nivel: {giveaway['level']}")
            print(f"  Región: {giveaway['region']}")
            print(f"  Copias: {giveaway['copies']}")
            print(f"  Participantes: {giveaway['entries']}")
            print()

        print("Datos guardados en 'member_stats.csv' y 'giveaways.csv'")
        print("Edita 'member_stats.csv' para agregar 'victorias jugadas' manualmente.")

    finally:
        driver.quit()

if __name__ == "__main__":
    main()